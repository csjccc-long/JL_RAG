#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
#
"""AIMLAPI 代理授权端点（OAuth 2.(0) 设备授权授予）。

允许已登录的 RAGFlow 用户在不离开提供商对话框的情况下获取 AIMLAPI 密钥。用户的 AIMLAPI 登录凭据永远不会触及 RAGFlow：它创建一个设备授权请求，用户在 AIMLAPI 同意页面（由浏览器在弹出窗口中打开）上批准该请求，RAGFlow 轮询令牌端点直到密钥颁发。设备代码保存在服务器端（Redis）；仅将颁发的 API 密钥返回给浏览器，以填入提供商表单。

配置（全部通过环境变量）：

AIMLAPI_APP_URL                  代理授权主机（默认 https://app.aimlapi.com
）

AIMLAPI_PARTNER_ID               合作伙伴 ID（默认为 RAGFlow 的；可覆盖更改）

AIMLAPI_SOURCE                   每个请求发送的客户端标识符（默认 agent/ragflow）

AIMLAPI_PARTNER_NAME             同意页面上显示的合作伙伴名称

AIMLAPI_VERIFICATION_BASE_URL    同意页面的基础 URL（默认 https://aimlapi.com
）

AIMLAPI_REQUESTED_USD_LIMIT_MINOR 请求的美元支出上限（以美元最小单位计，默认 1000）
"""

import asyncio
import json
import logging
import os
from urllib.parse import urlencode

import requests

from api.apps import login_required, current_user
from api.utils.api_utils import get_data_error_result, get_json_result, get_request_json, server_error_response, validate_request
from common.aimlapi_utils import attribution_headers, partner_id as _partner_id, source as _source
from rag.utils.redis_conn import REDIS_CONN

LOGGER = logging.getLogger(__name__)

# OAuth 2.0 设备授权授予（RFC 8628）
_DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
_REDIS_KEY_PREFIX = "aimlapi_authz:"
_HTTP_TIMEOUT = 15


def _app_url() -> str:
    return os.environ.get("AIMLAPI_APP_URL", "https://app.aimlapi.com").rstrip("/")


def _partner_name() -> str:
    return os.environ.get("AIMLAPI_PARTNER_NAME", "RAGFlow").strip()


def _verification_base_url() -> str:
    return os.environ.get("AIMLAPI_VERIFICATION_BASE_URL", "https://aimlapi.com").rstrip("/")


def _requested_usd_limit_minor() -> int:
    try:
        return int(os.environ.get("AIMLAPI_REQUESTED_USD_LIMIT_MINOR", "1000"))
    except (TypeError, ValueError):
        return 1000


@manager.route("/llm/aimlapi/authorize/start", methods=["POST"])  # noqa: F821
@login_required
async def aimlapi_authorize_start():
    """创建 AIMLAPI 设备授权请求并返回同意 URL"""
    partner_id = _partner_id()
    if not partner_id:
        return get_data_error_result(message="AIMLAPI partner id is not configured. Set AIMLAPI_PARTNER_ID.")

    # returnUrl 仅控制 AIMLAPI 在用户同意后将浏览器发送到的位置。
    # 此流程从不依赖它——密钥是通过经过身份验证的轮询到达的，并且成功后会关闭弹出窗口——因此，
    # 我们始终使用受信任的验证主机，而不是客户端提供的值，从而不留下开放重定向的攻击面。
    return_url = _verification_base_url()

    payload = {
        "partnerId": partner_id,
        "partnerName": _partner_name(),
        "agentName": "RAGFlow",
        "returnUrl": return_url,
        "requestedUsdLimitMinor": _requested_usd_limit_minor(),
    }
    try:
        resp = await asyncio.to_thread(
            requests.post,
            f"{_app_url()}/v3/agent-auth/authorizations",
            json=payload,
            headers=attribution_headers(),
            timeout=_HTTP_TIMEOUT,
        )
    except Exception as e:
        return server_error_response(e)

    if resp.status_code not in (200, 201):
        LOGGER.warning("AIMLAPI authorize start failed: status=%s body=%s", resp.status_code, resp.text[:300])
        return get_data_error_result(message=f"AIMLAPI authorization request failed (HTTP {resp.status_code}).")

    data = resp.json()
    request_id = data.get("requestId")
    device_code = data.get("deviceCode")
    if not request_id or not device_code:
        return get_data_error_result(message="AIMLAPI authorization response is missing requestId/deviceCode.")

    try:
        interval = int(data.get("interval", 5))
    except (TypeError, ValueError):
        interval = 5
    try:
        expires_in = int(data.get("expiresIn", 900))
    except (TypeError, ValueError):
        expires_in = 900

    # 在服务器端保存设备代码，并将其范围限定为该用户；该代码永远不会到达浏览器。
    REDIS_CONN.set_obj(
        f"{_REDIS_KEY_PREFIX}{request_id}",
        {"device_code": device_code, "user_id": current_user.id},
        expires_in,
    )
    LOGGER.info("AIMLAPI authorize start ok: request_id=%s", request_id)

    # 从 AIMLAPI_VERIFICATION_BASE_URL 重新构建同意 URL，以便应用环境变量覆盖；create 响应返回一个绝对 URL。

    # source 携带与请求头相同的客户端标识符：如果用户在同意过程中注册，
    # 该操作发生在 AIMLAPI 侧的浏览器流程中，请求头无法到达——查询参数是识别新账户的唯一方式。
    query = urlencode({"request": request_id, "source": _source()})
    verification_uri = f"{_verification_base_url()}/agent/authorize?{query}"
    return get_json_result(
        data={
            "request_id": request_id,
            "verification_uri": verification_uri,
            "interval": interval,
            "expires_in": expires_in,
        }
    )


@manager.route("/llm/aimlapi/authorize/poll", methods=["POST"])  # noqa: F821
@login_required
@validate_request("request_id")
async def aimlapi_authorize_poll():
    """轮询 AIMLAPI 令牌端点；一旦用户批准，即返回已颁发的密钥。"""
    req = await get_request_json()
    request_id = req["request_id"]

    raw = REDIS_CONN.get(f"{_REDIS_KEY_PREFIX}{request_id}")
    if not raw:
        return get_json_result(data={"status": "expired"})
    try:
        cached = json.loads(raw)
    except (TypeError, ValueError):
        cached = None
    if not cached or cached.get("user_id") != current_user.id:
        return get_data_error_result(message="Authorization request not found for the current user.")

    payload = {
        "partnerId": _partner_id(),
        "deviceCode": cached["device_code"],
        "grant_type": _DEVICE_CODE_GRANT,
    }
    try:
        resp = await asyncio.to_thread(
            requests.post,
            f"{_app_url()}/v3/agent-auth/token",
            json=payload,
            headers=attribution_headers(),
            timeout=_HTTP_TIMEOUT,
        )
    except Exception as e:
        return server_error_response(e)

    if resp.status_code not in (200, 201):
        LOGGER.warning("AIMLAPI authorize poll failed: status=%s body=%s", resp.status_code, resp.text[:300])
        return get_data_error_result(message=f"AIMLAPI token poll failed (HTTP {resp.status_code}).")

    data = resp.json()
    status = str(data.get("status", "")).lower()
    # success 字段名尚未在约定中固定；接受常见的变体。
    api_key = data.get("apiKey") or data.get("api_key") or data.get("access_token") or data.get("key")

    if api_key:
        REDIS_CONN.delete(f"{_REDIS_KEY_PREFIX}{request_id}")
        LOGGER.info("AIMLAPI authorize poll ready: request_id=%s", request_id)
        return get_json_result(data={"status": "ready", "api_key": api_key})
    if status in ("denied", "expired", "cancelled", "canceled", "rejected"):
        REDIS_CONN.delete(f"{_REDIS_KEY_PREFIX}{request_id}")
        return get_json_result(data={"status": status})
    return get_json_result(data={"status": status or "pending"})
