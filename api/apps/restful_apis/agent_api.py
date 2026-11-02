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

import asyncio
import base64
import copy
import hashlib
import hmac
import inspect
import ipaddress
import json
import logging
import time
from functools import partial, wraps
from typing import Set

from api.utils.file_response import (
    apply_download_file_response_headers,
    apply_preview_file_response_headers,
    resolve_attachment_content_type,
)
import jwt
from quart import Response, jsonify, request, make_response

from api.apps import AUTH_JWT, AUTH_API, AUTH_BETA, current_user, login_required
from api.apps.services.canvas_replica_service import CanvasReplicaService
from api.db import CanvasCategory
from api.db.db_models import Task
from api.db.services.api_service import API4ConversationService
from api.db.services.canvas_service import (
    CanvasTemplateService,
    UserCanvasService,
    completion as agent_completion,
    completion_openai,
)
from api.db.services.document_service import DocumentService
from api.db.services.file_service import FileService
from api.db.services.knowledgebase_service import KnowledgebaseService
from api.db.services.pipeline_operation_log_service import PipelineOperationLogService
from api.db.services.task_service import CANVAS_DEBUG_DOC_ID, TaskService, queue_dataflow
from api.db.services.user_service import TenantService, UserService
from api.db.services.user_canvas_version import UserCanvasVersionService
from api.utils.api_utils import (
    add_tenant_id_to_kwargs,
    check_duplicate_ids,
    get_data_error_result,
    get_error_data_result,
    get_json_result,
    get_result,
    get_request_json,
    server_error_response,
    validate_request,
)
from api.utils.pagination_utils import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, validate_rest_api_ids, validate_rest_api_page, validate_rest_api_page_size
from common import settings
from common.ssrf_guard import assert_host_is_safe
from common.constants import RetCode
from common.misc_utils import get_uuid, thread_pool_exec
from peewee import MySQLDatabase, PostgresqlDatabase

#保留对即发即弃任务的强引用，以防止它们在完成之前被垃圾回收。
_background_tasks: Set[asyncio.Task] = set()


def _canvas_json_default(obj):
    """Canvas SSE 事件的回退序列化器。

    Agent 组件将 functools.partial 对象存储为延迟流处理句柄（参见 llm.py、agent_with_tools.py、message.py）。
    这些对象会通过组件的输入/输出传播泄漏到 SSE 事件字典中，且不可被 JSON 序列化。该处理器将它们转换为 None，
    以确保下游消费者永远不会接收到不透明的 str(partial(...)) 表示形式。
    """
    if callable(obj):
        return None
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _require_canvas_access_sync(func):
    # 检查用户对给定代理的访问权限（同步）
    # @wraps(func)的作用是，它将返回的函数的文档字符串设置为原始函数的文档字符串。
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not UserCanvasService.accessible(kwargs.get("agent_id"), kwargs.get("tenant_id")):
            return get_json_result(data=False, message="Make sure you have permission to access the agent.", code=RetCode.OPERATING_ERROR)
        return func(*args, **kwargs)

    return wrapper


def _require_canvas_access_async(func):
    # 检查用户对给定代理的访问权限（异步）
    @wraps(func)
    async def wrapper(*args, **kwargs):
        agent_id = kwargs.get("agent_id")
        tenant_id = kwargs.get("tenant_id")
        if not await thread_pool_exec(UserCanvasService.accessible, agent_id, tenant_id):
            return get_json_result(data=False, message="Make sure you have permission to access the agent.", code=RetCode.OPERATING_ERROR)
        return await func(*args, **kwargs)

    return wrapper


def _require_canvas_owner_sync(func):
    # 检查用户对给定代理的创建权限（同步）
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not UserCanvasService.query(user_id=kwargs.get("tenant_id"), id=kwargs.get("agent_id")):
            return get_json_result(data=False, message="Only the owner of the agent is authorized for this operation.", code=RetCode.OPERATING_ERROR)
        return func(*args, **kwargs)

    return wrapper


def _is_truthy(value):
    """
    将值转换为布尔值。
    isinstance 作用：检查值是否为布尔类型、整数类型或字符串类型。
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _allow_anonymous_webhook(security_cfg: dict) -> bool:
    """
    检查给定的安全配置是否允许匿名 WebHook。
    """

    if not isinstance(security_cfg, dict):
        return False
    return _is_truthy(security_cfg.get("allow_anonymous"))


def _get_user_nickname(user_id: str) -> str:
    """
    根据用户 ID 获取用户昵称。
    """
    exists, user = UserService.get_by_id(user_id)
    if not exists:
        return user_id
    return str(getattr(user, "nickname", "") or user_id)


def _build_sse_response(body):
    # 创建 SSE 响应
    resp = Response(body, mimetype="text/event-stream")
    resp.headers.add_header("Cache-control", "no-cache")
    resp.headers.add_header("Connection", "keep-alive")
    resp.headers.add_header("X-Accel-Buffering", "no")
    resp.headers.add_header("Content-Type", "text/event-stream; charset=utf-8")
    return resp


def _normalize_agent_reference_entry(reference):
    """
    将给定的参考条目转换为标准格式。

    参数：
    - reference: 参考条目，可以是字典或列表。
    返回：
    - chunks: 标准化的块列表。
    - doc_aggs: 标准化的文档聚合列表。
    """
    if not isinstance(reference, dict):
        return {"chunks": [], "doc_aggs": []}
    if "chunks" in reference or "doc_aggs" in reference:
        return {
            "chunks": reference.get("chunks", []),
            "doc_aggs": reference.get("doc_aggs", []),
        }
    return {
        "chunks": reference.get("reference", reference.get("chunks", [])) or [],
        "doc_aggs": reference.get("doc_aggs", []) or [],
    }


def _normalize_agent_reference_chunk(chunk):
    """
    将给定的块转换为标准格式。

    参数：
    - chunk: 块，可以是字典或字符串。
    返回：
    - 标准化的块。
    """
    if not isinstance(chunk, dict):
        return {
            "id": chunk,
            "content": str(chunk),
            "document_id": None,
            "document_name": None,
            "dataset_id": None,
            "image_id": None,
            "positions": None,
        }

    return {
        "id": chunk.get("chunk_id", chunk.get("id")),
        "content": chunk.get("content_with_weight", chunk.get("content")),
        "document_id": chunk.get("doc_id", chunk.get("document_id")),
        "document_name": chunk.get("docnm_kwd", chunk.get("document_name")),
        "dataset_id": chunk.get("kb_id", chunk.get("dataset_id")),
        "image_id": chunk.get("image_id", chunk.get("img_id")),
        "positions": chunk.get("positions", chunk.get("position_int")),
    }


def _normalize_agent_session(conv):
    """
    将给定的会话转换为标准格式。

    参数：
    - conv: 会话，可以是字典。
    返回：
    - 标准化的会话。
    """
    conv["message"] = conv.get("message", [])
    # 移除 prompt防止泄露敏感信息
    for info in conv["message"]:
        if "prompt" in info:
            info.pop("prompt")
    conv["agent_id"] = conv.pop("dialog_id")
    if isinstance(conv["reference"], dict):
        if "chunks" in conv["reference"]:
            conv["reference"] = [conv["reference"]]
        else:
            conv["reference"] = [value for _, value in sorted(conv["reference"].items(), key=lambda item: int(item[0]))]
    elif isinstance(conv["reference"], list):
        conv["reference"] = [_normalize_agent_reference_entry(reference) for reference in conv["reference"]]
    else:
        conv["reference"] = []

    if conv["reference"]:
        # 过滤掉第一条消息（通常是系统消息）和用户消息，只保留助手消息。
        """
        将 conv["message"] 和 conv["reference"] 进行匹配，并生成一个列表，其中每个元素都是一个包含 message 和 reference 的字典。
        （只绑定助手消息）
        """
        messages = [message for i, message in enumerate(conv["message"]) if i != 0 and message["role"] != "user"]
        for message, reference in zip(messages, conv["reference"]):
            chunks = reference.get("chunks", [])
            if isinstance(chunks, dict):
                refs = []
                for citation_id, chunk in chunks.items():
                    ref = _normalize_agent_reference_chunk(chunk)
                    ref["citation_id"] = str(citation_id)
                    refs.append(ref)
                message["reference"] = refs
            elif isinstance(chunks, list):
                message["reference"] = [_normalize_agent_reference_chunk(chunk) for chunk in chunks]
            else:
                message["reference"] = []
    del conv["reference"]
    return conv


def _agent_session_list_result(data, total):
    # 返回会话列表结果
    return jsonify({"code": RetCode.SUCCESS, "message": "success", "data": data, "total": total})


async def _run_workflow_session(
    tenant_id,
    agent_id,
    workflow_conv,
    canvas,
    query,
    files,
    inputs,
    user_id,
    session_id,
    custom_header,
    canvas_title,
    canvas_category,
    return_trace,
    stream,
    chat_template_kwargs=None,
):
    """
    - 参数：
        - tenant_id: 租户 ID
        - agent_id: 代理 ID
        - workflow_conv: 工作流会话
        - canvas: 画布
        - query: 查询
        - files: 文件列表
        - inputs: 输入字典
        - user_id: 用户 ID
        - session_id: 会话 ID
        - custom_header: 自定义请求头
        - canvas_title: 画布标题
        - canvas_category: 画布类别
        - return_trace: 是否返回追踪信息
        - stream: 是否流式返回结果
        - chat_template_kwargs: 聊天模板参数
    """
    async def commit_runtime_replica():
        """
        提交运行时副本
        """
        commit_ok = CanvasReplicaService.commit_after_run(
            canvas_id=agent_id,
            tenant_id=str(tenant_id),
            runtime_user_id=user_id,
            dsl=json.loads(str(canvas)),
            canvas_category=canvas_category,
            title=canvas_title,
        )
        if not commit_ok:
            logging.error(
                "Canvas runtime replica commit failed: canvas_id=%s tenant_id=%s runtime_user_id=%s",
                agent_id,
                tenant_id,
                user_id,
            )

    workflow_conv.setdefault("message", [])
    if isinstance(workflow_conv.get("reference"), dict):
        if "chunks" in workflow_conv["reference"]:
            workflow_conv["reference"] = [workflow_conv["reference"]]
        else:
            workflow_conv["reference"] = [value for _, value in sorted(workflow_conv["reference"].items(), key=lambda item: int(item[0]))]
    elif not isinstance(workflow_conv.get("reference"), list):
        workflow_conv["reference"] = []

    # 将历史参考条目标准化为列表形式，以便后续处理
    workflow_conv["reference"] = [_normalize_agent_reference_entry(reference) for reference in workflow_conv["reference"]]

    turn_id = workflow_conv["message"][-1].get("id") if workflow_conv["message"] else get_uuid()
    full_content = ""
    reference = {}
    final_ans = {}
    trace_items = []
    structured_output = {}
    run_kwargs = {
        "query": query,
        "files": files,
        "user_id": user_id,
        "inputs": inputs,
    }
    if chat_template_kwargs is not None:
        run_kwargs["chat_template_kwargs"] = chat_template_kwargs

    async def persist_workflow_session():
        if not final_ans:
            return
        # 更新会话
        workflow_conv["message"].append(
            {
                "role": "assistant",
                "content": full_content,
                "created_at": time.time(),
                "id": turn_id,
            }
        )
        workflow_conv["reference"].append(_normalize_agent_reference_entry(reference))
        workflow_conv["dsl"] = json.loads(str(canvas))
        workflow_conv["source"] = workflow_conv.get("source") or "workflow"

        await thread_pool_exec(API4ConversationService.append_message, session_id, workflow_conv)
        await commit_runtime_replica()

    if stream:

        async def sse():
            # nonlocal 声明用于在嵌套函数中引用外部函数的变量。
            nonlocal full_content, reference, final_ans, trace_items, structured_output
            done_sent = False
            try:
                async for ans in canvas.run(**run_kwargs):
                    ans["session_id"] = session_id
                    if ans.get("event") == "message":
                        full_content += ans.get("data", {}).get("content", "")
                        if ans.get("data", {}).get("start_to_think", False):
                            full_content += "<think>"
                        elif ans.get("data", {}).get("end_to_think", False):
                            full_content += "</think>"
                    if ans.get("data", {}).get("reference", None):
                        reference.update(ans["data"]["reference"])
                    if ans.get("event") == "node_finished":
                        data = ans.get("data", {})
                        node_out = data.get("outputs", {})
                        component_id = data.get("component_id")
                        if component_id is not None and "structured" in node_out:
                            structured_output[component_id] = copy.deepcopy(node_out["structured"])
                        # 返回追踪信息
                        if return_trace:
                            trace_items.append(
                                {
                                    "component_id": data.get("component_id"),
                                    "trace": [copy.deepcopy(data)],
                                }
                            )
                    final_ans = ans
                    # yield ：告诉 Python 运行时，当前函数是一个生成器函数，可以返回多个值。
                    yield "data:" + json.dumps(ans, ensure_ascii=False, default=_canvas_json_default) + "\n\n"

                if final_ans:
                    if "data" not in final_ans or not isinstance(final_ans["data"], dict):
                        final_ans["data"] = {}
                    final_ans["data"]["content"] = full_content
                    final_ans["data"]["reference"] = reference
                    if structured_output:
                        final_ans["data"]["structured"] = structured_output
                    if trace_items:
                        final_ans["data"]["trace"] = trace_items
                else:
                    # Canvas 未产生任何事件（例如空查询）
                    # 但仍然返回 session_id，以便客户端可以恢复对话——否则 SSE 流只会是一个裸露的 [DONE]（修复 #15169）
                    logging.info(
                        "empty agent output - returning session_id (agent_id=%s session_id=%s stream=%s)",
                        agent_id,
                        session_id,
                        True,
                    )
                    yield ("data:" + json.dumps({"session_id": session_id, "data": {}}, ensure_ascii=False) + "\n\n")
                await persist_workflow_session()
            except Exception as exc:
                logging.exception(exc)
                canvas.cancel_task()
                yield ("data:" + json.dumps({"code": 500, "message": str(exc), "data": False}, ensure_ascii=False) + "\n\n")
            finally:
                if not done_sent:
                    done_sent = True
                    yield "data:[DONE]\n\n"

        return _build_sse_response(sse())

    try:
        async for ans in canvas.run(**run_kwargs):
            ans["session_id"] = session_id
            if ans.get("event") == "message":
                full_content += ans.get("data", {}).get("content", "")
                if ans.get("data", {}).get("start_to_think", False):
                    full_content += "<think>"
                elif ans.get("data", {}).get("end_to_think", False):
                    full_content += "</think>"
            if ans.get("data", {}).get("reference", None):
                reference.update(ans["data"]["reference"])
            if ans.get("event") == "node_finished":
                data = ans.get("data", {})
                node_out = data.get("outputs", {})
                component_id = data.get("component_id")
                if component_id is not None and "structured" in node_out:
                    structured_output[component_id] = copy.deepcopy(node_out["structured"])
                if return_trace:
                    trace_items.append(
                        {
                            "component_id": data.get("component_id"),
                            "trace": [copy.deepcopy(data)],
                        }
                    )
            final_ans = ans
    except Exception as exc:
        logging.exception(exc)
        canvas.cancel_task()
        return get_result(data=f"**ERROR**: {str(exc)}")

    if not final_ans:
        # Canvas 未产生任何事件（例如调用方发送了空查询）。
        # API 契约仍然承诺返回一个 session_id，以便客户端能够恢复对话——
        # 因此返回该 session_id 而非空字典（修复 #15169）。
        logging.info(
            "empty agent output - returning session_id (agent_id=%s session_id=%s stream=%s)",
            agent_id,
            session_id,
            False,
        )
        await commit_runtime_replica()
        return get_result(data={"session_id": session_id})

    if "data" not in final_ans or not isinstance(final_ans["data"], dict):
        final_ans["data"] = {}
    final_ans["data"]["content"] = full_content
    final_ans["data"]["reference"] = reference
    if structured_output:
        final_ans["data"]["structured"] = structured_output
    if trace_items:
        final_ans["data"]["trace"] = trace_items

    await persist_workflow_session()
    return get_result(data=final_ans)


@manager.route("/agents/<agent_id>/sessions", methods=["GET"])  # noqa: F821
@login_required # 作用：确保用户已登录，未登录的用户将被重定向到登录页面。
@add_tenant_id_to_kwargs # 作用：将租户ID添加到函数的关键字参数中，以便在处理请求时使用。
@_require_canvas_access_sync    # 作用：检查用户对智能助手的访问权限，并确保用户有权访问该智能助手。
def list_agent_sessions(agent_id, tenant_id):
    """获取指定智能助手的会话列表
    GET /agents/<agent_id>/sessions
    参数：
    - agent_id: 智能助手ID
    - id: 会话ID
    - user_id: 会话用户ID
    - page: 页码
    - page_size: 每页数量
    - keywords: 关键字
    - from_date: 开始时间
    - to_date: 结束时间
    - orderby: 排序字段
    - desc: 是否倒序

    """
    session_id = request.args.get("id")
    user_id = request.args.get("user_id")
    page_number = validate_rest_api_page(request.args.get("page", DEFAULT_PAGE))
    items_per_page = validate_rest_api_page_size(request.args.get("page_size", DEFAULT_PAGE_SIZE))
    keywords = request.args.get("keywords")
    from_date = request.args.get("from_date")
    to_date = request.args.get("to_date")
    orderby = request.args.get("orderby", "update_time")
    exp_user_id = request.args.get("exp_user_id")
    desc = request.args.get("desc") not in {"False", "false"}

    if exp_user_id:
        sessions = API4ConversationService.get_names(agent_id, exp_user_id)
        return _agent_session_list_result(sessions, len(sessions))

    include_dsl = request.args.get("dsl") not in {"False", "false"}
    total, sessions = API4ConversationService.get_list(
        agent_id,
        tenant_id,
        page_number,
        items_per_page,
        orderby,
        desc,
        session_id,
        user_id,
        include_dsl,
        keywords,
        from_date,
        to_date,
        exp_user_id=exp_user_id,
    )
    sessions = [_normalize_agent_session(session) for session in sessions]
    return _agent_session_list_result(sessions, total)


@manager.route("/agents/<agent_id>/sessions", methods=["POST"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def create_agent_session(agent_id, tenant_id):
    """创建智能助手会话
    POST /agents/<agent_id>/sessions
    参数：
    - agent_id: 智能助手ID
    - user_id: 会话用户ID
    - name: 会话名称
    - release: 是否使用发布版本
    - dsl: 会话DSL
    - message: 会话消息
    - source: 会话来源
    - exp_user_id: 会话用户ID
    """

    from agent.canvas import Canvas

    req = await get_request_json()
    user_id = req.get("user_id") or request.args.get("user_id", tenant_id)
    release_mode = bool(req.get("release", request.args.get("release", False)))

    try:
        cvs, dsl = UserCanvasService.get_agent_dsl_with_release(agent_id, release_mode, tenant_id)
    except LookupError:
        return get_data_error_result(message="Agent not found.")
    except PermissionError as e:
        return get_data_error_result(message=str(e))

    session_id = get_uuid()
    canvas = Canvas(dsl, tenant_id, agent_id, canvas_id=cvs.id)
    canvas.reset()

    cvs.dsl = json.loads(str(canvas))
    version_title = UserCanvasVersionService.get_latest_version_title(cvs.id, release_mode=release_mode)
    conv = {
        "id": session_id,
        "name": req.get("name", ""),
        "dialog_id": cvs.id,
        "user_id": user_id,
        "exp_user_id": user_id,
        "message": [{"role": "assistant", "content": canvas.get_prologue()}],
        "source": "agent",
        "dsl": cvs.dsl,
        "reference": [],
        "version_title": version_title,
    }
    API4ConversationService.save(**conv)
    return get_result(data=_normalize_agent_session(conv))


@manager.route("/agents/<agent_id>/sessions/<session_id>", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_sync
def get_agent_session(agent_id, session_id, tenant_id):
    """获取智能助手会话
    GET /agents/<agent_id>/sessions/<session_id>
    参数：
    - agent_id: 智能助手ID
    - session_id: 会话ID
    """
    exists, conv = API4ConversationService.get_by_id(session_id)
    if not exists or conv.dialog_id != agent_id:
        return get_data_error_result(message="Session not found!")
    return get_json_result(data=conv.to_dict())


@manager.route("/agents/<agent_id>/sessions/<session_id>", methods=["DELETE"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_sync
def delete_agent_session_item(agent_id, session_id, tenant_id):
    """删除智能助手会话
    DELETE /agents/<agent_id>/sessions/<session_id>
    参数：
    - agent_id: 智能助手ID
    - session_id: 会话ID
    """
    exists, conv = API4ConversationService.get_by_id(session_id)
    if not exists or conv.dialog_id != agent_id:
        return get_data_error_result(message="Session not found!")
    return get_json_result(data=API4ConversationService.delete_by_id(session_id))


@manager.route("/agents/<agent_id>/sessions", methods=["DELETE"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def delete_agent_session(tenant_id, agent_id):
    """批量删除智能助手会话
    DELETE /agents/<agent_id>/sessions
    参数：
    - agent_id: 智能助手ID
    - ids: 会话ID列表
    - delete_all: 是否删除所有会话
    """

    errors = []
    success_count = 0
    req = await get_request_json()
    cvs = await thread_pool_exec(UserCanvasService.query, user_id=tenant_id, id=agent_id)
    if not cvs:
        return get_error_data_result(f"You don't own the agent {agent_id}")

    if not req:
        return get_result()

    ids = req.get("ids")
    if not ids:
        if req.get("delete_all") is True:
            ids = [conv.id for conv in await thread_pool_exec(API4ConversationService.query, dialog_id=agent_id)]
            if not ids:
                return get_result()
        else:
            return get_result()

    conv_list = ids

    unique_conv_ids, duplicate_messages = check_duplicate_ids(conv_list, "session")
    conv_list = unique_conv_ids

    for session_id in conv_list:
        conv = await thread_pool_exec(API4ConversationService.query, id=session_id, dialog_id=agent_id)
        if not conv:
            errors.append(f"The agent doesn't own the session {session_id}")
            continue
        await thread_pool_exec(API4ConversationService.delete_by_id, session_id)
        success_count += 1

    if errors:
        if success_count > 0:
            return get_result(data={"success_count": success_count, "errors": errors}, message=f"Partially deleted {success_count} sessions with {len(errors)} errors")
        else:
            return get_error_data_result(message="; ".join(errors))

    if duplicate_messages:
        if success_count > 0:
            return get_result(message=f"Partially deleted {success_count} sessions with {len(duplicate_messages)} errors", data={"success_count": success_count, "errors": duplicate_messages})
        else:
            return get_error_data_result(message=";".join(duplicate_messages))

    return get_result()


@manager.route("/agents/download", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def download_agent_file(tenant_id):
    """下载智能助手文件
    GET /agents/download
    参数：
    - id: 文件ID
    """
    id = request.args.get("id")
    logging.info("Agent file download requested: tenant_id=%s file_id=%s", tenant_id, id)
    blob = await thread_pool_exec(FileService.get_blob, tenant_id, id)
    return Response(blob)


async def _iter_session_completion_events(tenant_id, agent_id, req, return_trace):
    """迭代会话完成事件
    GET /agents/<agent_id>/sessions/<session_id>
    参数：
    - tenant_id: 租户ID
    - agent_id: 智能助手ID
    - session_id: 会话ID
    """
    # 流式和非流式会话完成共享相同的事件解析和跟踪注入。
    trace_items = []
    async for answer in agent_completion(tenant_id=tenant_id, agent_id=agent_id, **req):
        if isinstance(answer, str):
            try:
                ans = json.loads(answer[5:])
            except Exception:
                continue
        else:
            ans = answer

        event = ans.get("event")
        if event == "node_finished":
            if return_trace:
                data = ans.get("data", {})
                trace_items.append(
                    {
                        "component_id": data.get("component_id"),
                        "trace": [copy.deepcopy(data)],
                    }
                )
                ans.setdefault("data", {})["trace"] = trace_items
            yield ans
            continue

        if event in ["message", "message_end", "user_inputs"]:
            if event == "user_inputs":
                logging.debug(
                    "Forwarding session completion event: tenant_id=%s agent_id=%s event=%s",
                    tenant_id,
                    agent_id,
                    event,
                )
            yield ans
            continue

        if event == "workflow_finished":
            # 仅转发运行级别聚合的 token 使用量，而非整个终端有效载荷（输入/输出），这样会话完成流接口就仅限于使用量契约所需的内容。
            logging.debug(
                "Forwarding session completion event: tenant_id=%s agent_id=%s event=%s",
                tenant_id,
                agent_id,
                event,
            )
            usage = ans.get("data", {}).get("usage")
            if usage is not None:
                yield {**ans, "data": {"usage": usage}}
            continue


@manager.route("/agents/templates", methods=["GET"])  # noqa: F821
@login_required
def list_agent_template():
    """列出智能助手模板
    GET /agents/templates
    """

    return get_json_result(data=[item.to_dict() for item in CanvasTemplateService.get_all()])


@manager.route("/agents/prompts", methods=["GET"])  # noqa: F821
@login_required
def prompts():
    """获取智能助手提示
    GET /agents/prompts
    """

    from rag.prompts.generator import (
        ANALYZE_TASK_SYSTEM,
        ANALYZE_TASK_USER,
        CITATION_PROMPT_TEMPLATE,
        NEXT_STEP,
        REFLECT,
    )

    return get_json_result(
        data={
            "task_analysis": f"{ANALYZE_TASK_SYSTEM}\n\n{ANALYZE_TASK_USER}",
            "plan_generation": NEXT_STEP,
            "reflection": REFLECT,
            "citation_guidelines": CITATION_PROMPT_TEMPLATE,
        }
    )


# 合成 canvas_category，前端将其传递给列表编译模板
#通过合并后的 /agents 端点进行分组。同时也是合并响应中
#打在分组项上的 type 鉴别器。
_COMPILATION_TEMPLATE_GROUP_CATEGORY = "compilation_template_group"


@manager.route("/agents", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
def list_agents(tenant_id):
    """列出智能助手
    GET /agents
    参数：
    - tenant_id: 租户ID
    - page_number: 页码
    - items_per_page: 每页数量
    - orderby: 排序字段
    - desc: 是否降序
    - id: 智能助手ID
    - name: 智能助手名称
    - canvas_category: 画布类别
    - tags: 标签
    - owner_ids: 拥有者ID列表
    - keywords: 关键字
    - type: 类型
    - filter: 过滤器
    """


    if request.args.get("type") == "filter":
        # 仅返回过滤器选项，而不返回智能助手列表
        tenants = TenantService.get_joined_tenants_by_user_id(tenant_id)
        joined_tenant_ids = list({member["tenant_id"] for member in tenants} | {tenant_id})
        owners = UserCanvasService.get_owner_filter(joined_tenant_ids, tenant_id)
        categories = UserCanvasService.get_category_filter(joined_tenant_ids, tenant_id)
        return get_json_result(
            data={
                "filter": {"owner": owners, "canvas_category": categories},
                "total": sum(owner["count"] for owner in owners),
            }
        )

    keywords = request.args.get("keywords", "")
    canvas_category_list = [item for item in request.args.get("canvas_category", "").strip().split(",") if item]
    canvas_type = request.args.get("canvas_type")
    owner_ids = [item for item in request.args.get("owner_ids", "").strip().split(",") if item]
    tags = [item for item in request.args.get("tags", "").strip().split(",") if item]
    try:
        validate_rest_api_ids(owner_ids, "owner_ids")
    except ValueError as e:
        return get_result(code=RetCode.ARGUMENT_ERROR, message=str(e))

    page_number = validate_rest_api_page(request.args.get("page", DEFAULT_PAGE))
    items_per_page = validate_rest_api_page_size(request.args.get("page_size", DEFAULT_PAGE_SIZE))
    order_by = request.args.get("orderby", "create_time")
    desc = str(request.args.get("desc", "true")).lower() != "false"
    tenants = TenantService.get_joined_tenants_by_user_id(tenant_id)
    authorized_owner_ids = {member["tenant_id"] for member in tenants}
    authorized_owner_ids.add(tenant_id)
    # 仅允许查询授权的 owner_ids，防止越权访问其他租户的智能助手
    if owner_ids:
        requested_owner_ids = set(owner_ids)
        unauthorized_owner_ids = requested_owner_ids - authorized_owner_ids
        if unauthorized_owner_ids:
            return get_json_result(
                data=False,
                message="Only authorized owner_ids can be queried.",
                code=RetCode.OPERATING_ERROR,
            )
        effective_owner_ids = list(requested_owner_ids)
    else:
        effective_owner_ids = list(authorized_owner_ids)
    include_template_groups = tenant_id in effective_owner_ids

    # 仅限组：当 compilation_template_group 是唯一选中的类别时，通过 list_saved 仅返回调用方的模板组（不含智能体），
    # 以便前端渲染专用标签页。list_saved 的分页在 Python 中实现。
    if canvas_category_list == [_COMPILATION_TEMPLATE_GROUP_CATEGORY]:
        from api.db.services.compilation_template_group_service import CompilationTemplateGroupService

        groups = []
        if include_template_groups:
            try:
                groups = CompilationTemplateGroupService.list_saved(tenant_id, keywords, "", order_by, desc)
            except Exception:
                logging.exception("list_agents: compilation template group list failed for tenant=%s", tenant_id)
        for group in groups:
            group["type"] = _COMPILATION_TEMPLATE_GROUP_CATEGORY
        total = len(groups)
        if page_number and items_per_page:
            start = (page_number - 1) * items_per_page
            groups = groups[start : start + items_per_page]
        return get_json_result(data={"canvas": groups, "total": total})
    # 实际分类有：智能助手、编译模板组，canvas_category_list 是所选类别列表（在数据库中不存在的类别）
    # 拆分所选类别：compilation_template_group 是合成的
    #（解析为模板组，而非智能体）；其余部分通过 canvas_category IN (...) 筛选智能体。
    wants_groups = _COMPILATION_TEMPLATE_GROUP_CATEGORY in canvas_category_list
    agent_categories = [c for c in canvas_category_list if c != _COMPILATION_TEMPLATE_GROUP_CATEGORY]

    # 合并模式：在没有 canvas_category（且没有仅限代理的过滤器）的情况下，按 update_time 交错列出调用方的编译模板组和代理。
    # canvas_type / tags 是仅限代理的概念，因此它们的存在会使响应保持为仅限代理。
    merge_groups = not canvas_category_list and not canvas_type and not tags
    if merge_groups:
        from api.db.services.compilation_template_group_service import CompilationTemplateGroupService

        # 获取每个匹配的 agent（page_number=0 表示禁用 SQL 分页），以便在 Python 中进行分页之前，可以对这两个来源进行全局排序。
        agents, _ = UserCanvasService.get_by_tenant_ids(
            effective_owner_ids,
            tenant_id,
            0,
            0,
            order_by,
            desc,
            keywords,
            None,
            tags,
            canvas_type,
        )
        # 组仅限所有者访问（不支持团队共享），因此其范围限定为调用者。关键字过滤组名；范围保持不过滤。
        groups = []
        if include_template_groups:
            try:
                groups = CompilationTemplateGroupService.list_saved(tenant_id, keywords, "", order_by, desc)
            except Exception:
                logging.exception("list_agents: compilation template group merge failed for tenant=%s", tenant_id)

        items: list[dict] = []
        for agent in agents:
            agent["type"] = "agent"
            items.append(agent)
        for group in groups:
            group["type"] = _COMPILATION_TEMPLATE_GROUP_CATEGORY
            group["title"] = group["name"]
            items.append(group)

        # 组仅限所有者访问（不支持团队共享），因此其范围限定为调用者。关键字过滤组名；范围保持不过滤。
        items.sort(key=lambda item: item.get("update_time") or 0, reverse=desc)

        total = len(items)
        if page_number and items_per_page:
            start = (page_number - 1) * items_per_page
            items = items[start : start + items_per_page]

        return get_json_result(data={"canvas": items, "total": total})

        #混合模式：同时选择了模板组和智能体类别 - 获取
        # 按智能体类别过滤后的智能体，并与模板组合并，
        # 按 update_time 交错排序（与合并模式相同的合并策略）。
    if wants_groups and agent_categories:
        from api.db.services.compilation_template_group_service import CompilationTemplateGroupService

        agents, _ = UserCanvasService.get_by_tenant_ids(
            effective_owner_ids,
            tenant_id,
            0,
            0,
            order_by,
            desc,
            keywords,
            agent_categories,
            tags,
            canvas_type,
        )
        groups = []
        if include_template_groups:
            try:
                groups = CompilationTemplateGroupService.list_saved(tenant_id, keywords, "", order_by, desc)
            except Exception:
                logging.exception("list_agents: compilation template group mixed failed for tenant=%s", tenant_id)

        items = []
        for agent in agents:
            agent["type"] = "agent"
            items.append(agent)
        for group in groups:
            group["type"] = _COMPILATION_TEMPLATE_GROUP_CATEGORY
            group["title"] = group["name"]
            items.append(group)
        items.sort(key=lambda item: item.get("update_time") or 0, reverse=desc)

        total = len(items)
        if page_number and items_per_page:
            start = (page_number - 1) * items_per_page
            items = items[start : start + items_per_page]

        return get_json_result(data={"canvas": items, "total": total})

    canvas, total = UserCanvasService.get_by_tenant_ids(
        effective_owner_ids,
        tenant_id,
        page_number,
        items_per_page,
        order_by,
        desc,
        keywords,
        agent_categories,
        tags,
        canvas_type,
    )

    return get_json_result(data={"canvas": canvas, "total": total})


@manager.route("/agents/tags", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
def list_agent_tags(tenant_id):
    """统计调用者可用的所有代理的标签使用次数。"""
    canvas_category = request.args.get("canvas_category")
    tenants = TenantService.get_joined_tenants_by_user_id(tenant_id)
    joined_ids = list({member["tenant_id"] for member in tenants} | {tenant_id})
    counts = UserCanvasService.list_tags(joined_ids, tenant_id, canvas_category)
    logging.info(
        "list_agent_tags tenant=%s canvas_category=%s tags_count=%d",
        tenant_id,
        canvas_category,
        len(counts),
    )
    return get_json_result(data=[{"tag": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: (-x[1], x[0]))])


@manager.route("/agents/<canvas_id>/tags", methods=["PUT"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def update_agent_tags(tenant_id, canvas_id):
    """更新代理的标签。"""
    if not UserCanvasService.accessible(canvas_id, tenant_id):
        logging.info(
            "update_agent_tags denied tenant=%s canvas_id=%s reason=no_permission",
            tenant_id,
            canvas_id,
        )
        return get_json_result(
            data=False,
            message="Agent not found or no permission.",
            code=RetCode.OPERATING_ERROR,
        )
    req = await get_request_json()
    tags = req.get("tags", "")
    incoming = tags if isinstance(tags, (list, tuple)) else [t for t in str(tags).split(",") if t.strip()]
    rows_affected = UserCanvasService.update_tags(canvas_id, tags)
    if rows_affected == 0:
        logging.info(
            "update_agent_tags miss tenant=%s canvas_id=%s incoming_count=%d rows=0",
            tenant_id,
            canvas_id,
            len(incoming),
        )
        return get_json_result(
            data=False,
            message="Agent not found or no permission.",
            code=RetCode.OPERATING_ERROR,
        )
    logging.info(
        "update_agent_tags ok tenant=%s canvas_id=%s incoming_count=%d rows=%d",
        tenant_id,
        canvas_id,
        len(incoming),
        rows_affected,
    )
    return get_json_result(data=True)


@manager.route("/agents", methods=["POST"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def create_agent(tenant_id):
    """创建agnet代理。"""
    req = {k: v for k, v in (await get_request_json()).items() if v is not None}
    req["canvas_type"] = req.get("canvas_type", "")
    req["user_id"] = tenant_id
    req["canvas_category"] = req.get("canvas_category") or CanvasCategory.Agent
    req["release"] = bool(req.get("release", ""))

    if req.get("dsl") is None:
        return get_json_result(
            data=False,
            message="No DSL data in request.",
            code=RetCode.ARGUMENT_ERROR,
        )

    try:
        req["dsl"] = CanvasReplicaService.normalize_dsl(req["dsl"])
    except ValueError as exc:
        return get_json_result(
            data=False,
            message=str(exc),
            code=RetCode.ARGUMENT_ERROR,
        )

    if req.get("title") is None:
        return get_json_result(
            data=False,
            message="No title in request.",
            code=RetCode.ARGUMENT_ERROR,
        )

    req["title"] = req["title"].strip()
    for canvas in UserCanvasService.query(user_id=tenant_id, canvas_category=req["canvas_category"]):
        canvas_title = getattr(canvas, "title", req["title"])
        if canvas_title and canvas_title.lower() == req["title"].lower():
            return get_data_error_result(message=f"{req['title']} already exists.")

    req["id"] = get_uuid()
    if not UserCanvasService.save(**req):
        return get_data_error_result(message="Fail to create agent.")

    owner_nickname = _get_user_nickname(tenant_id)
    UserCanvasVersionService.save_or_replace_latest(
        user_canvas_id=req["id"],
        title=UserCanvasVersionService.build_version_title(owner_nickname, req.get("title")),
        dsl=req["dsl"],
        release=req.get("release"),
    )
    replica_ok = CanvasReplicaService.replace_for_set(
        canvas_id=req["id"],
        tenant_id=str(tenant_id),
        runtime_user_id=str(tenant_id),
        dsl=req["dsl"],
        canvas_category=req["canvas_category"],
        title=req.get("title", ""),
    )
    if not replica_ok:
        return get_data_error_result(message="canvas saved, but replica sync failed.")

    exists, created_agent = UserCanvasService.get_by_canvas_id(req["id"])
    if not exists:
        return get_data_error_result(message="Fail to create agent.")
    return get_json_result(data=created_agent)


@manager.route("/agents/<agent_id>/upload", methods=["POST"])  # noqa: F821
@login_required(auth_types=[AUTH_JWT, AUTH_API, AUTH_BETA])
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def upload_agent_file(agent_id, tenant_id):
    """上传代理文件。"""
    files = await request.files
    file_objs = files.getlist("file") if files and files.get("file") else []
    logging.info(
        "Agent file upload requested: tenant_id=%s agent_id=%s file_count=%s",
        tenant_id,
        agent_id,
        len(file_objs),
    )
    try:
        if len(file_objs) == 1:
            uploaded = await thread_pool_exec(FileService.upload_info, tenant_id, file_objs[0], request.args.get("url"))
            return get_json_result(data=uploaded)
        results = await asyncio.gather(*(thread_pool_exec(FileService.upload_info, tenant_id, file_obj) for file_obj in file_objs))
        return get_json_result(data=results)
    except Exception as exc:
        logging.exception(
            "Agent file upload failed: tenant_id=%s agent_id=%s",
            tenant_id,
            agent_id,
        )
        return server_error_response(exc)


@manager.route("/agents/<agent_id>/components/<component_id>/input-form", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_sync
def get_agent_component_input_form(agent_id, component_id, tenant_id):
    """获取代理组件输入表单。"""
    try:
        from agent.canvas import Canvas

        exists, user_canvas = UserCanvasService.get_by_id(agent_id)
        if not exists:
            return get_data_error_result(message="canvas not found.")
        canvas = Canvas(json.dumps(user_canvas.dsl), tenant_id, canvas_id=user_canvas.id)
        return get_json_result(data=canvas.get_component_input_form(component_id))
    except Exception as exc:
        return server_error_response(exc)


@manager.route("/agents/<agent_id>/components/<component_id>/debug", methods=["POST"])  # noqa: F821
@validate_request("params")
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def debug_agent_component(agent_id, component_id, tenant_id):
    """调试代理组件。"""
    req = await get_request_json()
    try:
        from agent.canvas import Canvas
        from agent.component import LLM

        _, user_canvas = UserCanvasService.get_by_id(agent_id)
        canvas = Canvas(json.dumps(user_canvas.dsl), tenant_id, canvas_id=user_canvas.id)
        canvas.reset()
        canvas.message_id = get_uuid()
        component = canvas.get_component(component_id)["obj"]
        component.reset()

        if isinstance(component, LLM):
            # 伪装成一个会话，以便 LLM 组件可以访问会话上下文
            component.set_debug_inputs(req["params"])
        component.invoke(**{k: o["value"] for k, o in req["params"].items()})
        outputs = component.output()
        for k in outputs.keys():
            if isinstance(outputs[k], partial):
                txt = ""
                iter_obj = outputs[k]()
                if inspect.isasyncgen(iter_obj):
                    async for c in iter_obj:
                        txt += c
                else:
                    for c in iter_obj:
                        txt += c
                outputs[k] = txt
        return get_json_result(data=outputs)
    except Exception as exc:
        return server_error_response(exc)


@manager.route("/agents/<agent_id>", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
def get_agent(agent_id, tenant_id):
    """获取代理信息
    GET /agents/<agent_id>
    参数：agent_id
    返回：agent代理信息
    错误：
    - 404: 代理不存在
    """
    if not UserCanvasService.accessible(agent_id, tenant_id):
        return get_data_error_result(message="canvas not found.")

    exists, canvas = UserCanvasService.get_by_canvas_id(agent_id)
    if not exists:
        return get_data_error_result(message="canvas not found.")

    try:
        CanvasReplicaService.bootstrap(
            canvas_id=agent_id,
            tenant_id=str(tenant_id),
            runtime_user_id=str(tenant_id),
            dsl=canvas.get("dsl"),
            canvas_category=canvas.get("canvas_category", CanvasCategory.Agent),
            title=canvas.get("title", ""),
        )
    except ValueError as exc:
        return get_data_error_result(message=str(exc))

    last_publish_time = None
    versions = UserCanvasVersionService.list_by_canvas_id(agent_id)
    if versions:
        released_versions = [version for version in versions if version.release]
        if released_versions:
            released_versions.sort(key=lambda version: version.update_time, reverse=True)
            last_publish_time = released_versions[0].update_time

    from agent.dsl_migration import normalize_chunker_dsl
    # 兼容 chunker DSL 规范，确保前端可以正确渲染
    canvas["dsl"] = normalize_chunker_dsl(canvas.get("dsl", {}))
    canvas["last_publish_time"] = last_publish_time

    if canvas.get("canvas_category") == CanvasCategory.DataFlow:
        datasets = list(KnowledgebaseService.query(pipeline_id=agent_id))
        canvas["datasets"] = [{"id": item.id, "name": item.name, "avatar": item.avatar} for item in datasets]

    return get_json_result(data=canvas)


@manager.route("/agents/<agent_id>/versions", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_sync
def list_agent_versions(agent_id, tenant_id):
    """获取agent代理所有历史版本
    GET /agents/<agent_id>/versions
    参数：agent_id
    返回：agent代理历史版本列表
    错误：
    - 404: 代理不存在
    """
    try:
        versions = sorted(
            [item.to_dict() for item in UserCanvasVersionService.list_by_canvas_id(agent_id)],
            key=lambda item: item["update_time"] * -1,
        )
        return get_json_result(data=versions)
    except Exception as exc:
        return get_data_error_result(message=f"Error getting history files: {exc}")


@manager.route("/agents/<agent_id>/versions/<version_id>", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_sync
def get_agent_version(agent_id, version_id, tenant_id):
    """获取agent代理指定历史版本
    GET /agents/<agent_id>/versions/<version_id>
    参数：agent_id, version_id
    返回：agent代理历史版本
    错误：
    - 404: 代理不存在
    """
    try:
        exists, version = UserCanvasVersionService.get_by_id(version_id)
        if not exists or not version or str(version.user_canvas_id) != str(agent_id):
            return get_data_error_result(message="Version not found.")
        return get_json_result(data=version.to_dict())
    except Exception as exc:
        return get_data_error_result(message=f"Error getting history file: {exc}")


@manager.route("/agents/<agent_id>/logs/<message_id>", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def get_agent_logs(agent_id, message_id, tenant_id):
    """从 Redis 中读取指定 Agent 在某一次会话（message_id）运行期间产生的结构化日志，
    用来在前端展示节点执行过程、耗时和中间结果，这些数据是临时的、由引擎写入、接口只读
    """
    try:
        from rag.utils.redis_conn import REDIS_CONN

        binary = await thread_pool_exec(REDIS_CONN.get, f"{agent_id}-{message_id}-logs")
        if not binary:
            return get_json_result(data={})

        payload = binary.decode("utf-8") if isinstance(binary, bytes) else binary
        return get_json_result(data=json.loads(payload))
    except Exception as exc:
        logging.exception(exc)
        return server_error_response(exc)


@manager.route("/agents/<agent_id>", methods=["DELETE"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_owner_sync
def delete_agent(agent_id, tenant_id):
    """删除agent代理
    DELETE /agents/<agent_id>
    参数：agent_id
    返回：删除结果
    错误：
    - 404: 代理不存在
    """

    UserCanvasService.delete_by_id(agent_id)
    return get_json_result(data=True)


@manager.route("/agents/<agent_id>", methods=["PUT"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def update_agent(agent_id, tenant_id):
    """更新agent代理
    PUT /agents/<agent_id>
    参数：agent_id
    返回：更新结果
    错误：
    - 404: 代理不存在
    """
    req = {k: v for k, v in (await get_request_json()).items() if v is not None}
    req["canvas_type"] = req.get("canvas_type", "")
    req["release"] = bool(req.get("release", ""))

    if req.get("dsl") is not None:
        try:
            from agent.canvas import Canvas

            req["dsl"] = CanvasReplicaService.normalize_dsl(req["dsl"])
            Canvas.validate_component_parameters(req["dsl"])
        except ValueError as exc:
            return get_json_result(
                data=False,
                message=str(exc),
                code=RetCode.ARGUMENT_ERROR,
            )

    _, current_agent = UserCanvasService.get_by_id(agent_id)
    if req.get("title") is not None:
        req["title"] = req["title"].strip()
        canvas_category_for_duplicate_check = req.get("canvas_category") or (current_agent.canvas_category if current_agent else CanvasCategory.Agent)
        for canvas in UserCanvasService.query(user_id=tenant_id, canvas_category=canvas_category_for_duplicate_check):
            canvas_title = getattr(canvas, "title", "")
            if getattr(canvas, "id", None) != agent_id and canvas_title and canvas_title.lower() == req["title"].lower():
                return get_data_error_result(message=f"{req['title']} already exists.")

    agent_title_for_version = req.get("title") or (current_agent.title if current_agent else "")
    canvas_category = req.get("canvas_category") or (current_agent.canvas_category if current_agent else CanvasCategory.Agent)
    owner_nickname = _get_user_nickname(tenant_id)
    UserCanvasService.update_by_id(agent_id, req)

    if req.get("dsl") is not None:
        UserCanvasVersionService.save_or_replace_latest(
            user_canvas_id=agent_id,
            title=UserCanvasVersionService.build_version_title(owner_nickname, agent_title_for_version),
            dsl=req["dsl"],
            release=req.get("release"),
        )
        replica_ok = CanvasReplicaService.replace_for_set(
            canvas_id=agent_id,
            tenant_id=str(tenant_id),
            runtime_user_id=str(tenant_id),
            dsl=req["dsl"],
            canvas_category=canvas_category,
            title=agent_title_for_version,
        )
        if not replica_ok:
            return get_data_error_result(message="agent saved, but replica sync failed.")

    _, updated_agent = UserCanvasService.get_by_id(agent_id)
    return get_json_result(data={"update_time": updated_agent.update_time})


@manager.route("/agents/<agent_id>/reset", methods=["POST"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
@_require_canvas_access_async
async def reset_agent(agent_id, tenant_id):
    """重置agent代理
    POST /agents/<agent_id>/reset
    参数：agent_id
    返回：重置结果
    错误：
    - 404: 代理不存在
    """
    try:
        from agent.canvas import Canvas

        exists, user_canvas = UserCanvasService.get_by_id(agent_id)
        if not exists:
            return get_data_error_result(message="canvas not found.")

        canvas = Canvas(json.dumps(user_canvas.dsl), tenant_id, canvas_id=user_canvas.id)
        canvas.reset()
        dsl = json.loads(str(canvas))
        UserCanvasService.update_by_id(agent_id, {"dsl": dsl})
        replica_ok = CanvasReplicaService.replace_for_set(
            canvas_id=agent_id,
            tenant_id=str(tenant_id),
            runtime_user_id=str(tenant_id),
            dsl=dsl,
            canvas_category=user_canvas.canvas_category,
            title=user_canvas.title,
        )
        if not replica_ok:
            return get_data_error_result(message="agent reset, but replica sync failed.")
        return get_json_result(data=dsl)
    except Exception as exc:
        return server_error_response(exc)


@manager.route("/agents/rerun", methods=["POST"])  # noqa: F821
@validate_request("id", "dsl", "component_id")
@login_required
@add_tenant_id_to_kwargs
async def rerun_agent(tenant_id):
    """重运行agent代理
    POST /agents/rerun
    参数：
    - id: 文档id
    - dsl: agent dsl
    - component_id: 组件id
    返回：重运行结果
    错误：
    - 404: 文档不存在
    """

    from rag.nlp import search

    req = await get_request_json()
    doc = PipelineOperationLogService.get_documents_info(req["id"])
    if not doc:
        return get_data_error_result(message="Document not found.")
    doc = doc[0]
    if not DocumentService.accessible(doc["id"], tenant_id):
        logging.warning(
            "rerun_agent denied: tenant_id=%s log_id=%s doc_id=%s",
            tenant_id,
            req["id"],
            doc["id"],
        )
        return get_data_error_result(message="Document not found.")
    if 0 < doc["progress"] < 1:
        return get_data_error_result(message=f"`{doc['name']}` is processing...")

    from rag.advanced_rag.knowlege_compile.dataset_nav import remove_dataset_nav_doc_sync

    remove_dataset_nav_doc_sync(tenant_id, doc["kb_id"], doc["id"])
    if settings.docStoreConn.index_exist(search.index_name(tenant_id), doc["kb_id"]):
        settings.docStoreConn.delete({"doc_id": doc["id"]}, search.index_name(tenant_id), doc["kb_id"])
    doc["progress_msg"] = ""
    doc["chunk_num"] = 0
    doc["token_num"] = 0
    DocumentService.clear_chunk_num_when_rerun(doc["id"])
    DocumentService.update_by_id(doc["id"], doc)
    TaskService.filter_delete([Task.doc_id == doc["id"]])

    dsl = req["dsl"]
    dsl["path"] = [req["component_id"]]
    PipelineOperationLogService.update_by_id(req["id"], {"dsl": dsl})
    queue_dataflow(
        tenant_id=tenant_id,
        flow_id=req["id"],
        task_id=get_uuid(),
        doc_id=doc["id"],
        priority=0,
        rerun=True,
    )
    return get_json_result(data=True)


@manager.route("/agents/test_db_connection", methods=["POST"])  # noqa: F821
@validate_request("db_type", "database", "username", "host", "port", "password")
@login_required
async def test_db_connection():
    """测试数据库连接
    POST /agents/test_db_connection
    参数：
    - db_type: 数据库类型
    - database: 数据库名称
    - username: 数据库用户名
    - host: 数据库主机
    - port: 数据库端口
    - password: 数据库密码
    返回：测试结果
    错误：
    - 400: 参数错误
    - 401: 未登录
    - 500: 服务器错误
    """

    req = await get_request_json()
    try:
        safe_host = assert_host_is_safe(req["host"])
    except ValueError as exc:
        logging.warning(
            "Rejected test_db_connection: unsafe host %r (db_type=%s, user=%s): %s",
            req.get("host"),
            req.get("db_type"),
            current_user.id,
            exc,
        )
        return get_data_error_result(message=str(exc))
    except OSError as exc:
        logging.warning(
            "Rejected test_db_connection: cannot resolve host %r (db_type=%s, user=%s): %s",
            req.get("host"),
            req.get("db_type"),
            current_user.id,
            exc,
        )
        logging.debug("Full resolver exception for host %r", req.get("host"), exc_info=True)
        return get_data_error_result(message=f"Could not resolve host {req.get('host')!r}.")
    try:
        if req["db_type"] in ["mysql", "mariadb"]:
            db = MySQLDatabase(
                req["database"],
                user=req["username"],
                host=safe_host,
                port=req["port"],
                password=req["password"],
            )
            with db.connection_context():
                db.execute_sql("SELECT 1")
        elif req["db_type"] == "postgres":
            db = PostgresqlDatabase(
                req["database"],
                user=req["username"],
                host=safe_host,
                port=req["port"],
                password=req["password"],
            )
            with db.connection_context():
                db.execute_sql("SELECT 1")
        elif req["db_type"] == "mssql":
            import pyodbc

            connection_string = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={safe_host},{req['port']};DATABASE={req['database']};UID={req['username']};PWD={req['password']};"
            db = pyodbc.connect(connection_string)
            try:
                cursor = db.cursor()
                try:
                    cursor.execute("SELECT 1")
                finally:
                    cursor.close()
            finally:
                db.close()
        elif req["db_type"] == "IBM DB2":
            import ibm_db

            conn_str = f"DATABASE={req['database']};HOSTNAME={safe_host};PORT={req['port']};PROTOCOL=TCPIP;UID={req['username']};PWD={req['password']};"
            logging.info(
                "DATABASE=%s;HOSTNAME=%s;PORT=%s;PROTOCOL=TCPIP;UID=%s;PWD=****;",
                req["database"],
                safe_host,
                req["port"],
                req["username"],
            )
            conn = ibm_db.connect(conn_str, "", "")
            stmt = ibm_db.exec_immediate(conn, "SELECT 1 FROM sysibm.sysdummy1")
            ibm_db.fetch_assoc(stmt)
            ibm_db.close(conn)
        elif req["db_type"] == "trino":
            import os
            import trino

            db_name = req["database"]
            if "." in db_name:
                catalog, schema = db_name.split(".", 1)
            elif "/" in db_name:
                catalog, schema = db_name.split("/", 1)
            else:
                catalog, schema = db_name, "default"

            http_scheme = "https" if os.environ.get("TRINO_USE_TLS", "0") == "1" else "http"
            auth = None
            if http_scheme == "https" and req.get("password"):
                auth = trino.BasicAuthentication(req.get("username") or "ragflow", req["password"])

            conn = trino.dbapi.connect(
                host=safe_host,
                port=int(req["port"] or 8080),
                user=req["username"] or "ragflow",
                catalog=catalog,
                schema=schema or "default",
                http_scheme=http_scheme,
                auth=auth,
            )
            try:
                cur = conn.cursor()
                try:
                    cur.execute("SELECT 1")
                    cur.fetchall()
                finally:
                    cur.close()
            finally:
                conn.close()
        else:
            return server_error_response("Unsupported database type.")

        return get_json_result(data="Database Connection Successful!")
    except Exception as exc:
        return server_error_response(exc)


# NOTE: 单数形式 /agents/chat/completion 是早期版本中的一个历史拼写错误——没有任何客户端、SDK 或文档使用过它，而下面的复数形式才是规范路由。
# 单数形式被有意地未注册；发送该请求的客户端会收到 404 响应。
@manager.route("/agents/chat/completions", methods=["POST"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def agent_chat_completion(tenant_id, agent_id=None):
    """执行agent代理的对话式运行
    POST /agents/chat/completions
    参数：
    - agent_id: 代理id
    - session_id: 会话id
    - openai-compatible: 是否兼容openai接口
    返回：
    - 运行结果
    错误：
    - 运行错误
    """
    # 该端点提供两种执行模式：

    # 1. 无会话状态的草稿/运行时执行。请求针对调用方的运行时副本运行，该副本由可编辑画布状态填充。

    # 2. 使用现有 session_id 的会话延续。请求从存储的 API4Conversation 状态恢复，并且必须绑定到同一智能体和可访问的画布。

    #

    # 安全约束：

    # - agent_id 始终在路由层提供，不会作为自由格式的 kwarg 向下游转发。

    # - 没有 session_id 的新运行必须在加载运行时副本之前通过 UserCanvasService.accessible(...) 检查。

    # - 现有会话在将控制权交给较低级别的完成函数之前，会在此路由层进行验证，因此 canvas_service 仅执行预先授权的会话负载。
    req = await get_request_json()
    agent_id = agent_id or req.get("agent_id")
    openai_compatible = bool(req.get("openai-compatible", False))
    if not agent_id:
        return get_json_result(
            data=False,
            message="`agent_id` is required.",
            code=RetCode.ARGUMENT_ERROR,
        )
    # 路由级选择器不应被转发到较低级别的完成函数中
    req = dict(req)
    req.pop("agent_id", None)
    req.pop("openai-compatible", None)
    session_id = req.get("session_id")
    workflow_session = False
    workflow_conv = None
    if session_id:
        exists, conv = API4ConversationService.get_by_id(session_id)
        if not exists:
            return get_data_error_result(message="Session not found!")
        if conv.dialog_id != agent_id:
            return get_json_result(
                data=False,
                message="Session does not belong to the requested agent.",
                code=RetCode.OPERATING_ERROR,
            )
        if not UserCanvasService.accessible(agent_id, tenant_id):
            return get_json_result(
                data=False,
                message="Only authorized users can access this agent session.",
                code=RetCode.OPERATING_ERROR,
            )
        workflow_session = getattr(conv, "source", "") == "workflow"
        if workflow_session:
            workflow_conv = conv.to_dict()

    if openai_compatible:
        # OpenAI 兼容模式使用不同的传输格式，请将其与常规代理事件分开。
        messages = req.get("messages", [])
        if not messages:
            return get_data_error_result(message="You must provide at least one message.")
        question = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
        stream = req.pop("stream", False)
        session_id = req.pop("session_id", req.get("id", "")) or req.get("metadata", {}).get("id", "")
        if stream:
            return _build_sse_response(
                completion_openai(
                    tenant_id,
                    agent_id,
                    question,
                    session_id=session_id,
                    stream=True,
                    **req,
                )
            )

        async for response in completion_openai(
            tenant_id,
            agent_id,
            question,
            session_id=session_id,
            stream=False,
            **req,
        ):
            return jsonify(response)
        return None

    if workflow_session:
        query = req.get("query", "") or req.get("question", "")
        files = req.get("files", [])
        inputs = req.get("inputs", {})
        runtime_user_id = req.get("user_id") or tenant_id
        user_id = str(runtime_user_id)
        custom_header = req.get("custom_header", "")

        _, cvs = await thread_pool_exec(UserCanvasService.get_by_id, agent_id)
        if not cvs:
            return get_data_error_result(message="canvas not found.")

        if not isinstance(workflow_conv.get("message"), list):
            workflow_conv["message"] = []
        if isinstance(workflow_conv.get("reference"), dict):
            if "chunks" in workflow_conv["reference"]:
                workflow_conv["reference"] = [workflow_conv["reference"]]
            else:
                workflow_conv["reference"] = [value for _, value in sorted(workflow_conv["reference"].items(), key=lambda item: int(item[0]))]
        elif not isinstance(workflow_conv.get("reference"), list):
            workflow_conv["reference"] = []
        workflow_conv["reference"] = [_normalize_agent_reference_entry(reference) for reference in workflow_conv["reference"]]
        turn_id = get_uuid()
        workflow_conv["message"].append(
            {
                "role": "user",
                "content": query,
                "id": turn_id,
                "files": files,
                "created_at": time.time(),
            }
        )
        await thread_pool_exec(API4ConversationService.update_by_id, session_id, workflow_conv)

        try:
            from agent.canvas import Canvas

            workflow_dsl = workflow_conv.get("dsl", {})
            if isinstance(workflow_dsl, str):
                dsl_str = workflow_dsl
            else:
                dsl_str = json.dumps(workflow_dsl, ensure_ascii=False)
            canvas = Canvas(dsl_str, str(tenant_id), task_id=session_id, canvas_id=agent_id, custom_header=custom_header)
        except Exception as exc:
            return server_error_response(exc)

        return await _run_workflow_session(
            tenant_id=tenant_id,
            agent_id=agent_id,
            workflow_conv=workflow_conv,
            canvas=canvas,
            query=query,
            files=files,
            inputs=inputs,
            user_id=user_id,
            session_id=session_id,
            custom_header=custom_header,
            canvas_title=getattr(cvs, "title", ""),
            canvas_category=getattr(cvs, "canvas_category", CanvasCategory.Agent),
            return_trace=bool(req.get("return_trace", False)),
            stream=req.get("stream", False),
            chat_template_kwargs=req.get("chat_template_kwargs"),
        )

    if not session_id:
        if not UserCanvasService.accessible(agent_id, tenant_id):
            return get_json_result(
                data=False,
                message="Make sure you have permission to access the agent.",
                code=RetCode.OPERATING_ERROR,
            )

        #保持原始工作流执行路径，但分配一个 session_id，以便响应结构更接近旧版代理完成契约。
        query = req.get("query", "") or req.get("question", "")
        files = req.get("files", [])
        inputs = req.get("inputs", {})
        runtime_user_id = req.get("user_id") or tenant_id
        user_id = str(runtime_user_id)
        custom_header = req.get("custom_header", "")
        session_id = get_uuid()

        _, cvs = await thread_pool_exec(UserCanvasService.get_by_id, agent_id)
        if not cvs:
            return get_data_error_result(message="canvas not found.")

        replica_payload = CanvasReplicaService.load_for_run(
            canvas_id=agent_id,
            tenant_id=str(tenant_id),
            runtime_user_id=user_id,
        )
        if not replica_payload:
            try:
                replica_payload = CanvasReplicaService.bootstrap(
                    canvas_id=agent_id,
                    tenant_id=str(tenant_id),
                    runtime_user_id=user_id,
                    dsl=cvs.dsl,
                    canvas_category=getattr(cvs, "canvas_category", CanvasCategory.Agent),
                    title=getattr(cvs, "title", ""),
                )
            except ValueError as exc:
                return get_data_error_result(message=str(exc))
        if not replica_payload:
            return get_data_error_result(message="canvas replica not found, please fetch the agent first.")

        replica_dsl = replica_payload.get("dsl", {})
        canvas_title = replica_payload.get("title", "")
        canvas_category = replica_payload.get("canvas_category", CanvasCategory.Agent)
        dsl_str = json.dumps(replica_dsl, ensure_ascii=False)

        if cvs.canvas_category == CanvasCategory.DataFlow:
            from rag.flow.pipeline import Pipeline

            task_id = get_uuid()
            workflow_conv = {
                "id": session_id,
                "dialog_id": cvs.id,
                "user_id": user_id,
                "exp_user_id": user_id,
                "name": req.get("name", ""),
                "message": [
                    {
                        "role": "user",
                        "content": query,
                        "id": task_id,
                        "files": files,
                        "created_at": time.time(),
                    }
                ],
                "reference": [],
                "source": "workflow",
                "dsl": replica_dsl,
                "version_title": await thread_pool_exec(
                    UserCanvasVersionService.get_latest_version_title,
                    cvs.id,
                    release_mode=False,
                ),
            }
            await thread_pool_exec(API4ConversationService.save, **workflow_conv)
            Pipeline(
                dsl_str,
                tenant_id=str(tenant_id),
                doc_id=CANVAS_DEBUG_DOC_ID,
                task_id=task_id,
                flow_id=agent_id,
            )
            ok, error_message = await thread_pool_exec(
                queue_dataflow,
                user_id,
                agent_id,
                task_id,
                CANVAS_DEBUG_DOC_ID,
                files[0],
                0,
            )
            if not ok:
                return get_data_error_result(message=error_message)
            return get_json_result(data={"message_id": task_id, "session_id": session_id})

        try:
            from agent.canvas import Canvas

            canvas = Canvas(dsl_str, str(tenant_id), task_id=session_id, canvas_id=agent_id, custom_header=custom_header)
            canvas.clear_history()
        except Exception as exc:
            return server_error_response(exc)
        turn_id = get_uuid()
        workflow_conv = {
            "id": session_id,
            "dialog_id": cvs.id,
            "user_id": user_id,
            "exp_user_id": user_id,
            "name": req.get("name") or (query[:250] if query else "") or "",
            "message": [
                {
                    "role": "user",
                    "content": query,
                    "id": turn_id,
                    "files": files,
                    "created_at": time.time(),
                }
            ],
            "reference": [],
            "source": "workflow",
            "dsl": replica_dsl,
            "version_title": await thread_pool_exec(
                UserCanvasVersionService.get_latest_version_title,
                cvs.id,
                release_mode=False,
            ),
        }
        workflow_conv["reference"] = [_normalize_agent_reference_entry(reference) for reference in workflow_conv["reference"]]
        await thread_pool_exec(API4ConversationService.save, **workflow_conv)
        return await _run_workflow_session(
            tenant_id=tenant_id,
            agent_id=agent_id,
            workflow_conv=workflow_conv,
            canvas=canvas,
            query=query,
            files=files,
            inputs=inputs,
            user_id=user_id,
            session_id=session_id,
            custom_header=custom_header,
            canvas_title=canvas_title,
            canvas_category=canvas_category,
            return_trace=bool(req.get("return_trace", False)),
            stream=req.get("stream", False),
            chat_template_kwargs=req.get("chat_template_kwargs"),
        )

    return_trace = bool(req.get("return_trace", False))
    if req.get("stream", False):

        async def generate():
            emitted = False
            async for ans in _iter_session_completion_events(tenant_id, agent_id, req, return_trace):
                emitted = True
                yield "data:" + json.dumps(ans, ensure_ascii=False, default=_canvas_json_default) + "\n\n"
            if not emitted:
                # 与新会话 SSE 路径保持一致：如果画布在现有会话中没有产生任何事件（例如空查询），
                # 仍然回显 session_id，以便客户端能够获取它，而不是只看到一个光秃秃的 [DONE]（修复 #15169）。
                logging.info(
                    "empty agent output - returning session_id (agent_id=%s session_id=%s stream=%s)",
                    agent_id,
                    session_id,
                    True,
                )
                yield ("data:" + json.dumps({"session_id": session_id, "data": {}}, ensure_ascii=False) + "\n\n")
            yield "data:[DONE]\n\n"

        return _build_sse_response(generate())

    full_content = ""
    reference = {}
    final_ans = {}
    trace_items = []
    structured_output = {}
    run_usage = None
    async for ans in _iter_session_completion_events(tenant_id, agent_id, req, return_trace):
        try:
            if ans["event"] == "message":
                full_content += ans["data"]["content"]
            if ans.get("data", {}).get("reference", None):
                reference.update(ans["data"]["reference"])
            if ans.get("event") == "node_finished":
                data = ans.get("data", {})
                node_out = data.get("outputs", {})
                component_id = data.get("component_id")
                if component_id is not None and "structured" in node_out:
                    structured_output[component_id] = copy.deepcopy(node_out["structured"])
                if return_trace:
                    trace_items.append(
                        {
                            "component_id": data.get("component_id"),
                            "trace": [copy.deepcopy(data)],
                        }
                    )
            if ans.get("event") == "workflow_finished":
                # 捕获运行级别的使用情况，但将 message_end/user_inputs 保留为

                # final_ans，以保持非流式响应结构不变。
                run_usage = ans.get("data", {}).get("usage")
                continue
            if ans.get("event") == "message_end":
                final_ans = ans
            elif ans.get("event") == "user_inputs" and not final_ans:
                final_ans = ans
        except Exception as exc:
            return get_result(data=f"**ERROR**: {str(exc)}")

    if not final_ans:
        # 与新会话路径相同的约定：即使画布没有发出任何内容（例如针对现有会话的空查询），也会回显 session_id，以便客户端可以继续使用它（修复 #15169）
        logging.info(
            "empty agent output - returning session_id (agent_id=%s session_id=%s stream=%s)",
            agent_id,
            session_id,
            False,
        )
        return get_result(data={"session_id": session_id})

    if "data" not in final_ans or not isinstance(final_ans["data"], dict):
        final_ans["data"] = {}
    final_ans["data"]["content"] = full_content
    final_ans["data"]["reference"] = reference
    if run_usage:
        final_ans["data"]["usage"] = run_usage
    if structured_output:
        final_ans["data"]["structured"] = structured_output
    if return_trace and final_ans:
        final_ans["data"]["trace"] = trace_items
    return get_result(data=final_ans)


@manager.route("/agents/<agent_id>/webhook", methods=["POST", "GET", "PUT", "PATCH", "DELETE", "HEAD"])  # noqa: F821
async def webhook(agent_id: str):

    return await _webhook_impl(agent_id, is_test=False)


@manager.route("/agents/<agent_id>/webhook/test", methods=["POST", "GET", "PUT", "PATCH", "DELETE", "HEAD"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def webhook_test(agent_id: str, tenant_id: str):
    """测试agent代理的webhook触发
    POST /agents/<agent_id>/webhook/test
    GET /agents/<agent_id>/webhook/test
        参数：agent_id
        返回：
        { "data": true }
    """
    if not UserCanvasService.query(user_id=tenant_id, id=agent_id):
        logging.warning(
            "Webhook test denied: owner check failed agent_id=%s tenant_id=%s method=%s",
            agent_id,
            tenant_id,
            request.method,
        )
        return get_json_result(data=False, message="Only the owner of the agent is authorized for this operation.", code=RetCode.OPERATING_ERROR)
    return await _webhook_impl(agent_id, is_test=True)


async def _webhook_impl(agent_id: str, is_test: bool):
    start_ts = time.time()

    # 1.通过 agent_id 获取画布
    exists, cvs = UserCanvasService.get_by_id(agent_id)
    if not exists:
        return get_data_error_result(code=RetCode.BAD_REQUEST, message="Canvas not found."), RetCode.BAD_REQUEST

    # 2.检查画布类别
    if cvs.canvas_category == CanvasCategory.DataFlow:
        return get_data_error_result(code=RetCode.BAD_REQUEST, message="Dataflow can not be triggered by webhook."), RetCode.BAD_REQUEST

    # 3. 从画布加载 DSL
    dsl = getattr(cvs, "dsl", None)
    if not isinstance(dsl, dict):
        return get_data_error_result(code=RetCode.BAD_REQUEST, message="Invalid DSL format."), RetCode.BAD_REQUEST

    # 4.检查 DSL 中的 webhook 配置
    webhook_cfg = {}
    components = dsl.get("components", {})
    for k, _ in components.items():
        cpn_obj = components[k]["obj"]
        if cpn_obj["component_name"].lower() == "begin" and cpn_obj["params"]["mode"] == "Webhook":
            webhook_cfg = cpn_obj["params"]

    if not webhook_cfg:
        return get_data_error_result(code=RetCode.BAD_REQUEST, message="Webhook not configured for this agent."), RetCode.BAD_REQUEST

    # 5. 根据 webhook_cfg.methods 验证请求方法
    allowed_methods = webhook_cfg.get("methods", [])
    request_method = request.method.upper()
    if allowed_methods and request_method not in allowed_methods:
        return get_data_error_result(code=RetCode.BAD_REQUEST, message=f"HTTP method '{request_method}' not allowed for this webhook."), RetCode.BAD_REQUEST

    async def validate_webhook_security(security_cfg: dict):
        """根据安全配置验证 Webhook 安全规则。"""

        if not isinstance(security_cfg, dict) or not security_cfg:
            logging.warning(
                "Webhook denied: missing security config agent_id=%s method=%s",
                agent_id,
                request.method,
            )
            raise Exception("Webhook security is required. Set allow_anonymous to true to permit unauthenticated webhooks.")

        # 1. 验证最大请求体大小
        await _validate_max_body_size(security_cfg)

        # 2. 验证 IP 白名单
        _validate_ip_whitelist(security_cfg)

        # 3. 验证速率限制
        _validate_rate_limit(security_cfg)

        # 4. 验证身份验证
        auth_type = security_cfg.get("auth_type", "none")

        if auth_type == "none":
            if not _allow_anonymous_webhook(security_cfg):
                logging.warning(
                    "Webhook denied: anonymous access missing explicit opt-in agent_id=%s method=%s",
                    agent_id,
                    request.method,
                )
                raise Exception("Anonymous webhook access requires allow_anonymous to be true")
            return

        if auth_type == "token":
            _validate_token_auth(security_cfg)

        elif auth_type == "basic":
            _validate_basic_auth(security_cfg)

        elif auth_type == "jwt":
            _validate_jwt_auth(security_cfg)

        else:
            raise Exception(f"Unsupported auth_type: {auth_type}")

    async def _validate_max_body_size(security_cfg):
        """检查请求大小不超过 max_body_size。"""
        max_size = security_cfg.get("max_body_size")
        if not max_size:
            max_size = "10MB"

        # 将“10MB”转换为字节
        units = {"kb": 1024, "mb": 1024**2}
        size_str = max_size.lower()

        for suffix, factor in units.items():
            if size_str.endswith(suffix):
                limit = int(size_str.replace(suffix, "")) * factor
                break
        else:
            raise Exception("Invalid max_body_size format")
        MAX_LIMIT = 10 * 1024 * 1024  # 10MB
        if limit > MAX_LIMIT:
            raise Exception("max_body_size exceeds maximum allowed size (10MB)")

        content_length = request.content_length or 0
        if content_length > limit:
            raise Exception(f"Request body too large: {content_length} > {limit}")

    def _validate_ip_whitelist(security_cfg):
        """只允许白名单中的 IP。"""
        whitelist = security_cfg.get("ip_whitelist", [])
        if not whitelist:
            return

        client_ip = request.remote_addr

        for rule in whitelist:
            if "/" in rule:
                # CIDR表示法
                if ipaddress.ip_address(client_ip) in ipaddress.ip_network(rule, strict=False):
                    return
            else:
                #单个IP
                if client_ip == rule:
                    return

        raise Exception(f"IP {client_ip} is not allowed by whitelist")

    def _validate_rate_limit(security_cfg):
        """简单的内存速率限制。"""
        rl = security_cfg.get("rate_limit")
        if not rl:
            rl = {"limit": 60, "per": "minute"}

        limit = int(rl.get("limit", 60))
        if limit <= 0:
            raise Exception("rate_limit.limit must be > 0")
        per = rl.get("per", "minute")

        window = {
            "second": 1,
            "minute": 60,
            "hour": 3600,
            "day": 86400,
        }.get(per)

        if not window:
            raise Exception(f"Invalid rate_limit.per: {per}")

        capacity = limit
        rate = limit / window
        cost = 1

        key = f"rl:tb:{agent_id}"
        now = time.time()

        try:
            from rag.utils.redis_conn import REDIS_CONN

            res = REDIS_CONN.lua_token_bucket(
                keys=[key],
                args=[capacity, rate, now, cost],
                client=REDIS_CONN.REDIS,
            )

            allowed = int(res[0])
            if allowed != 1:
                raise Exception("Too many requests (rate limit exceeded)")

        except Exception as e:
            raise Exception(f"Rate limit error: {e}")

    def _validate_token_auth(security_cfg):
        """验证基于请求头的令牌身份验证。"""
        token_cfg = security_cfg.get("token", {})
        header = token_cfg.get("token_header")
        token_value = token_cfg.get("token_value")

        provided = request.headers.get(header)
        if provided != token_value:
            raise Exception("Invalid token authentication")

    def _validate_basic_auth(security_cfg):
        """验证 HTTP 基本身份验证凭据。"""
        auth_cfg = security_cfg.get("basic_auth", {})
        username = auth_cfg.get("username")
        password = auth_cfg.get("password")

        auth = request.authorization
        if not auth or auth.username != username or auth.password != password:
            raise Exception("Invalid Basic Auth credentials")

    def _validate_jwt_auth(security_cfg):
        """验证 Authorization 头中的 JWT 令牌。"""
        jwt_cfg = security_cfg.get("jwt", {})
        secret = jwt_cfg.get("secret")
        if not secret:
            raise Exception("JWT secret not configured")

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise Exception("Missing Bearer token")

        token = auth_header[len("Bearer ") :].strip()
        if not token:
            raise Exception("Empty Bearer token")

        alg = (jwt_cfg.get("algorithm") or "HS256").upper()

        decode_kwargs = {
            "key": secret,
            "algorithms": [alg],
        }
        options = {}
        if jwt_cfg.get("audience"):
            decode_kwargs["audience"] = jwt_cfg["audience"]
            options["verify_aud"] = True
        else:
            options["verify_aud"] = False

        if jwt_cfg.get("issuer"):
            decode_kwargs["issuer"] = jwt_cfg["issuer"]
            options["verify_iss"] = True
        else:
            options["verify_iss"] = False
        try:
            decoded = jwt.decode(
                token,
                options=options,
                **decode_kwargs,
            )
        except Exception as e:
            raise Exception(f"Invalid JWT: {str(e)}")

        raw_required_claims = jwt_cfg.get("required_claims", [])
        if isinstance(raw_required_claims, str):
            required_claims = [raw_required_claims]
        elif isinstance(raw_required_claims, (list, tuple, set)):
            required_claims = list(raw_required_claims)
        else:
            required_claims = []

        required_claims = [c for c in required_claims if isinstance(c, str) and c.strip()]

        RESERVED_CLAIMS = {"exp", "sub", "aud", "iss", "nbf", "iat"}
        for claim in required_claims:
            if claim in RESERVED_CLAIMS:
                raise Exception(f"Reserved JWT claim cannot be required: {claim}")

        for claim in required_claims:
            if claim not in decoded:
                raise Exception(f"Missing JWT claim: {claim}")

        return decoded

    try:
        security_config = webhook_cfg.get("security", {})
        await validate_webhook_security(security_config)
    except Exception as e:
        return get_data_error_result(code=RetCode.BAD_REQUEST, message=str(e)), RetCode.BAD_REQUEST
    if not isinstance(cvs.dsl, str):
        dsl = json.dumps(cvs.dsl, ensure_ascii=False)
    try:
        from agent.canvas import Canvas

        canvas = Canvas(dsl, cvs.user_id, agent_id, canvas_id=agent_id)
    except Exception as e:
        resp = get_data_error_result(code=RetCode.BAD_REQUEST, message=str(e))
        resp.status_code = RetCode.BAD_REQUEST
        return resp

    # 7. 解析请求体
    async def parse_webhook_request(content_type):
        """Parse request based on content-type and return structured data."""

        # 1. 查询参数
        query_data = {k: v for k, v in request.args.items()}

        # 2. Headers
        header_data = {k: v for k, v in request.headers.items()}

        # 3. Body
        ctype = request.headers.get("Content-Type", "").split(";")[0].strip()
        if ctype and ctype != content_type:
            raise ValueError(f"Invalid Content-Type: expect '{content_type}', got '{ctype}'")

        body_data: dict = {}

        try:
            if ctype == "application/json":
                body_data = await request.get_json() or {}

            elif ctype == "multipart/form-data":
                nonlocal canvas
                form = await request.form
                files = await request.files

                body_data = {}

                for key, value in form.items():
                    body_data[key] = value

                if len(files) > 10:
                    raise Exception("Too many uploaded files")
                for key, file in files.items():
                    desc = FileService.upload_info(
                        cvs.user_id,  # user
                        file,  # FileStorage
                        None,  # url (None for webhook)
                    )
                    file_parsed = await canvas.get_files_async([desc])
                    body_data[key] = file_parsed

            elif ctype == "application/x-www-form-urlencoded":
                form = await request.form
                body_data = dict(form)

            else:
                # text/plain / octet-stream / empty / unknown
                raw = await request.get_data()
                if raw:
                    try:
                        body_data = json.loads(raw.decode("utf-8"))
                    except Exception:
                        body_data = {}
                else:
                    body_data = {}

        except Exception:
            body_data = {}

        return {
            "query": query_data,
            "headers": header_data,
            "body": body_data,
            "content_type": ctype,
        }

    def extract_by_schema(data, schema, name="section"):
        """
        仅提取模式中定义的字段。

        必须存在必填字段。

        可选字段默认为基于类型的默认值。

        包含类型验证。
        """
        props = schema.get("properties", {})
        required = schema.get("required", [])

        extracted = {}

        for field, field_schema in props.items():
            field_type = field_schema.get("type")

            # 1.缺少必填字段
            if field in required and field not in data:
                raise Exception(f"{name} missing required field: {field}")

            # 2. 可选 → 默认值
            if field not in data:
                extracted[field] = default_for_type(field_type)
                continue

            raw_value = data[field]

            # 3. 自动转换值
            try:
                value = auto_cast_value(raw_value, field_type)
            except Exception as e:
                raise Exception(f"{name}.{field} auto-cast failed: {str(e)}")

            # 4. 类型验证
            if not validate_type(value, field_type):
                raise Exception(f"{name}.{field} type mismatch: expected {field_type}, got {type(value).__name__}")

            extracted[field] = value

        return extracted

    def default_for_type(t):
        """返回给定模式类型的默认值"""
        if t == "file":
            return []
        if t == "object":
            return {}
        if t == "boolean":
            return False
        if t == "number":
            return 0
        if t == "string":
            return ""
        if t and t.startswith("array"):
            return []
        if t == "null":
            return None
        return None

    def auto_cast_value(value, expected_type):
        """在可能的情况下，将字符串值转换为模式类型。"""

        # 已经是良好的非字符串值
        if not isinstance(value, str):
            return value

        v = value.strip()

        # Boolean
        if expected_type == "boolean":
            if v.lower() in ["true", "1"]:
                return True
            if v.lower() in ["false", "0"]:
                return False
            raise Exception(f"Cannot convert '{value}' to boolean")

        # Number
        if expected_type == "number":
            # integer
            if v.isdigit() or (v.startswith("-") and v[1:].isdigit()):
                return int(v)

            # float
            try:
                return float(v)
            except Exception:
                raise Exception(f"Cannot convert '{value}' to number")

        # Object
        if expected_type == "object":
            try:
                parsed = json.loads(v)
                if isinstance(parsed, dict):
                    return parsed
                else:
                    raise Exception("JSON is not an object")
            except Exception:
                raise Exception(f"Cannot convert '{value}' to object")

        # Array <T>
        if expected_type.startswith("array"):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
                else:
                    raise Exception("JSON is not an array")
            except Exception:
                raise Exception(f"Cannot convert '{value}' to array")

        # String (accept original)
        if expected_type == "string":
            return value

        # File
        if expected_type == "file":
            return value
        # Default: do nothing
        return value

    def validate_type(value, t):
        """根据模式类型 t 验证值类型"""
        if t == "file":
            return isinstance(value, list)

        if t == "string":
            return isinstance(value, str)

        if t == "number":
            return isinstance(value, (int, float))

        if t == "boolean":
            return isinstance(value, bool)

        if t == "object":
            return isinstance(value, dict)

        # array<string> / array<number> / array<object>
        if t.startswith("array"):
            if not isinstance(value, list):
                return False

            if "<" in t and ">" in t:
                inner = t[t.find("<") + 1 : t.find(">")]

                # Check each element type
                for item in value:
                    if not validate_type(item, inner):
                        return False

            return True

        return True

    parsed = await parse_webhook_request(webhook_cfg.get("content_types"))
    SCHEMA = webhook_cfg.get("schema", {"query": {}, "headers": {}, "body": {}})

    # 严格按照模式提取
    try:
        query_clean = extract_by_schema(parsed["query"], SCHEMA.get("query", {}), name="query")
        header_clean = extract_by_schema(parsed["headers"], SCHEMA.get("headers", {}), name="headers")
        body_clean = extract_by_schema(parsed["body"], SCHEMA.get("body", {}), name="body")
    except Exception as e:
        return get_data_error_result(code=RetCode.BAD_REQUEST, message=str(e)), RetCode.BAD_REQUEST

    clean_request = {"query": query_clean, "headers": header_clean, "body": body_clean, "input": parsed}

    execution_mode = webhook_cfg.get("execution_mode", "Immediately")
    response_cfg = webhook_cfg.get("response", {})

    def append_webhook_trace(agent_id: str, start_ts: float, event: dict, ttl=600):
        """添加 WebHook 跟踪
        事件示例：
        { "ts": 1680000000.0, "event": "request", "data": { "query": {}, "headers": {}, "body": {}, "input": {} } }
        { "ts": 1680000000.0, "event": "response", "data": { "status": 200, "headers": {}, "body": {} } }
        """
        from rag.utils.redis_conn import REDIS_CONN

        key = f"webhook-trace-{agent_id}-logs"

        raw = REDIS_CONN.get(key)
        obj = json.loads(raw) if raw else {"webhooks": {}}

        ws = obj["webhooks"].setdefault(str(start_ts), {"start_ts": start_ts, "events": []})

        ws["events"].append({"ts": time.time(), **event})

        REDIS_CONN.set_obj(key, obj, ttl)

    if execution_mode == "Immediately":
        status = response_cfg.get("status", 200)
        try:
            status = int(status)
        except (TypeError, ValueError):
            return get_data_error_result(code=RetCode.BAD_REQUEST, message=str(f"Invalid response status code: {status}")), RetCode.BAD_REQUEST

        if not (200 <= status <= 399):
            return get_data_error_result(code=RetCode.BAD_REQUEST, message=str(f"Invalid response status code: {status}, must be between 200 and 399")), RetCode.BAD_REQUEST

        body_tpl = response_cfg.get("body_template", "")

        def parse_body(body: str):
            if not body:
                return None, "application/json"

            try:
                parsed = json.loads(body)
                return parsed, "application/json"
            except (json.JSONDecodeError, TypeError):
                return body, "text/plain"

        body, content_type = parse_body(body_tpl)
        resp = Response(
            json.dumps(body, ensure_ascii=False) if content_type == "application/json" else body,
            status=status,
            content_type=content_type,
        )

        async def background_run():
            """在后台运行画布"""
            try:
                async for ans in canvas.run(query="", user_id=cvs.user_id, webhook_payload=clean_request):
                    if is_test:
                        append_webhook_trace(agent_id, start_ts, ans)

                if is_test:
                    append_webhook_trace(
                        agent_id,
                        start_ts,
                        {
                            "event": "finished",
                            "elapsed_time": time.time() - start_ts,
                            "success": True,
                        },
                    )

                cvs.dsl = json.loads(str(canvas))
                UserCanvasService.update_by_id(cvs.user_id, cvs.to_dict())

            except Exception as e:
                logging.exception("Webhook background run failed")
                if is_test:
                    try:
                        append_webhook_trace(
                            agent_id,
                            start_ts,
                            {
                                "event": "error",
                                "message": str(e),
                                "error_type": type(e).__name__,
                            },
                        )
                        append_webhook_trace(
                            agent_id,
                            start_ts,
                            {
                                "event": "finished",
                                "elapsed_time": time.time() - start_ts,
                                "success": False,
                            },
                        )
                    except Exception:
                        logging.exception("Failed to append webhook trace")

        task = asyncio.create_task(background_run())
        if isinstance(task, asyncio.Task):
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
        return resp
    else:

        async def sse():
            nonlocal canvas
            contents: list[str] = []
            status = 200
            try:
                async for ans in canvas.run(
                    query="",
                    user_id=cvs.user_id,
                    webhook_payload=clean_request,
                ):
                    if ans["event"] == "message":
                        content = ans["data"]["content"]
                        if ans["data"].get("start_to_think", False):
                            content = "<think>"
                        elif ans["data"].get("end_to_think", False):
                            content = "</think>"
                        if content:
                            contents.append(content)
                    if ans["event"] == "message_end":
                        status = int(ans["data"].get("status", status))
                    if is_test:
                        append_webhook_trace(agent_id, start_ts, ans)
                if is_test:
                    append_webhook_trace(
                        agent_id,
                        start_ts,
                        {
                            "event": "finished",
                            "elapsed_time": time.time() - start_ts,
                            "success": True,
                        },
                    )
                final_content = "".join(contents)
                return {
                    "message": final_content,
                    "success": True,
                    "code": status,
                }

            except Exception as e:
                if is_test:
                    append_webhook_trace(
                        agent_id,
                        start_ts,
                        {
                            "event": "error",
                            "message": str(e),
                            "error_type": type(e).__name__,
                        },
                    )
                    append_webhook_trace(
                        agent_id,
                        start_ts,
                        {
                            "event": "finished",
                            "elapsed_time": time.time() - start_ts,
                            "success": False,
                        },
                    )
                return {"code": 400, "message": str(e), "success": False}

        result = await sse()
        return Response(
            json.dumps(result),
            status=result["code"],
            mimetype="application/json",
        )


@manager.route("/agents/<agent_id>/webhook/logs", methods=["GET"])  # noqa: F821
@login_required
async def webhook_trace(agent_id: str):
    """获取agent代理的webhook触发日志"""
    exists, cvs = UserCanvasService.get_by_id(agent_id)
    if not exists or str(cvs.user_id) != str(current_user.id):
        return get_data_error_result(
            message="Canvas not found.",
        )

    def encode_webhook_id(start_ts: str) -> str:
        WEBHOOK_ID_SECRET = "webhook_id_secret"
        sig = hmac.new(
            WEBHOOK_ID_SECRET.encode("utf-8"),
            start_ts.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")

    def decode_webhook_id(enc_id: str, webhooks: dict) -> str | None:
        for ts in webhooks.keys():
            if encode_webhook_id(ts) == enc_id:
                return ts
        return None

    since_ts = request.args.get("since_ts", type=float)
    webhook_id = request.args.get("webhook_id")

    key = f"webhook-trace-{agent_id}-logs"
    from rag.utils.redis_conn import REDIS_CONN

    raw = REDIS_CONN.get(key)

    if since_ts is None:
        now = time.time()
        return get_json_result(
            data={
                "webhook_id": None,
                "events": [],
                "next_since_ts": now,
                "finished": False,
            }
        )

    if not raw:
        return get_json_result(
            data={
                "webhook_id": None,
                "events": [],
                "next_since_ts": since_ts,
                "finished": False,
            }
        )

    obj = json.loads(raw)
    webhooks = obj.get("webhooks", {})

    if webhook_id is None:
        candidates = [float(k) for k in webhooks.keys() if float(k) > since_ts]

        if not candidates:
            return get_json_result(
                data={
                    "webhook_id": None,
                    "events": [],
                    "next_since_ts": since_ts,
                    "finished": False,
                }
            )

        start_ts = min(candidates)
        real_id = str(start_ts)
        webhook_id = encode_webhook_id(real_id)

        return get_json_result(
            data={
                "webhook_id": webhook_id,
                "events": [],
                "next_since_ts": start_ts,
                "finished": False,
            }
        )

    real_id = decode_webhook_id(webhook_id, webhooks)

    if not real_id:
        return get_json_result(
            data={
                "webhook_id": webhook_id,
                "events": [],
                "next_since_ts": since_ts,
                "finished": True,
            }
        )

    ws = webhooks.get(str(real_id))
    events = ws.get("events", [])
    new_events = [e for e in events if e.get("ts", 0) > since_ts]

    next_ts = since_ts
    for e in new_events:
        next_ts = max(next_ts, e["ts"])

    finished = any(e.get("event") == "finished" for e in new_events)

    return get_json_result(
        data={
            "webhook_id": webhook_id,
            "events": new_events,
            "next_since_ts": next_ts,
            "finished": finished,
        }
    )


def _attachment_request_metadata():
    """从请求中提取附件的元数据"""
    ext = request.args.get("ext")
    mime_type = request.args.get("mime_type")
    filename = request.args.get("filename")
    content_type, resolved_ext = resolve_attachment_content_type(ext, mime_type)
    if not content_type:
        content_type = "application/octet-stream"
    if not resolved_ext:
        resolved_ext = ext.lower().strip(".") if isinstance(ext, str) and ext else "bin"
    return content_type, resolved_ext, filename


async def _stream_agent_attachment(tenant_id, attachment_id, *, inline: bool):
    """ 在 MCP 客户端中流式传输由代理生成的附件以进行下载或内联预览 """
    attachment_id = attachment_id or request.view_args.get("attachment_id")
    content_type, ext, filename = _attachment_request_metadata()
    data = await thread_pool_exec(settings.STORAGE_IMPL.get, tenant_id, attachment_id)
    if not data:
        return get_data_error_result(message="document not found")
    response = await make_response(data)
    if inline:
        apply_preview_file_response_headers(response, content_type, ext, filename)
    else:
        apply_download_file_response_headers(response, content_type, ext, filename)
    return response


@manager.route("/agents/attachments/<attachment_id>/preview", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def preview_attachment(tenant_id=None, attachment_id=None):
    """在 MCP 客户端中流式传输由代理生成的附件以进行内联预览"""
    try:
        return await _stream_agent_attachment(tenant_id, attachment_id, inline=True)
    except Exception as e:
        return server_error_response(e)


@manager.route("/agents/attachments/<attachment_id>/download", methods=["GET"])  # noqa: F821
@login_required(auth_types=[AUTH_JWT, AUTH_API, AUTH_BETA])
@add_tenant_id_to_kwargs
async def download_attachment(tenant_id=None, attachment_id=None):
    """在 MCP 客户端中流式传输由代理生成的附件以进行下载"""
    try:
        if request.args.get("disposition", "").lower() == "inline":
            return await _stream_agent_attachment(tenant_id, attachment_id, inline=True)
        return await _stream_agent_attachment(tenant_id, attachment_id, inline=False)
    except Exception as e:
        return server_error_response(e)
