#
#  Copyright 2024 The InfiniFlow Authors. All Rights Reserved.
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
import json
import logging
import os
import re
import time
from abc import ABC
from functools import partial
from urllib.parse import urlparse

import requests

from agent.component.base import ComponentBase, ComponentParamBase
from common.connection_utils import timeout
from common.ssrf_guard import assert_url_is_safe, pin_dns
from deepdoc.parser import HtmlParser
"""
它的职责是：把工作流中的变量组装成 HTTP 请求，发给指定 URL，并把返回结果写回到当前组件输出，供后续步骤继续处理。

它本质上是 Agent 工作流中的“外部接口调用节点”。

具体功能
1. 定义调用参数
InvokeParam 里定义了请求相关的配置：

proxy：代理
headers：请求头
method：get / post / put
variables：请求参数列表
url：目标地址
timeout：超时时间
clean_html：是否提取纯文本
datatype：json 或 formdata
这些参数决定了“怎么调用远程接口”。

2. 解析输入变量
_resolve_arg_value() 和 _resolve_variable_value() 会把流程中的变量值解析出来，支持：

直接变量引用
模板变量替换
字符串模板渲染
这样请求参数可以动态依赖上游组件输出。

3. 构造请求
_build_request_args() 会根据 variables 把参数组织成请求体。

JSON 模式：自动尝试把字符串值转成 JSON
非 JSON 模式：按表单/普通参数形式发出
_build_url() 会把模板中的变量替换到真实 URL 里。

4. 处理安全校验
这里加入了 SSRF 防护：

assert_url_is_safe(url)
pin_dns(...)
它会校验目标 URL 是否安全，防止请求到非法地址，避免服务器端请求伪造漏洞。

还会校验 proxy 地址是否安全。

5. 发起 HTTP 请求
_send_request() 会使用 requests 发起请求：

GET：传 params
POST / PUT：传 json 或 data
并设置超时和重定向限制。

6. 处理响应
_format_response() 会返回原始文本，或者在 clean_html=True 时对 HTML 做文本提取。
也就是它能把网页返回内容转成更适合后续 LLM/流程处理的文本。

7. 输出执行结果
最终 _invoke() 会把返回内容写入：

self.set_output("result", result)
这样后续节点可以直接读取这个结果。"""

class InvokeParam(ComponentParamBase):
    """
    Define the Invoke component parameters.
    """

    def __init__(self):
        super().__init__()
        self.proxy = None
        self.headers = ""
        self.method = "get"
        self.variables = []
        self.url = ""
        self.timeout = 60
        self.clean_html = False
        self.datatype = "json"

    def check(self):
        self.check_valid_value(self.method.lower(), "Type of content from the crawler", ["get", "post", "put"])
        self.check_empty(self.url, "End point URL")
        self.check_positive_integer(self.timeout, "Timeout time in second")
        self.check_boolean(self.clean_html, "Clean HTML")
        self.check_valid_value(self.datatype.lower(), "Data post type", ["json", "formdata"])  # Check for valid datapost value


class Invoke(ComponentBase, ABC):
    component_name = "Invoke"
    header_variable_ref_patt = r"\{([a-zA-Z_][a-zA-Z0-9_.@-]*)\}"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pinned_hostname: str | None = None
        self._pinned_ip: str | None = None

    @staticmethod
    def _coerce_json_arg_if_possible(key, value):
        raw_value = value
        if isinstance(value, str):
            try:
                value = json.loads(value)
                logging.debug(
                    "Invoke JSON arg coercion succeeded. key=%s parsed_type=%s",
                    key,
                    type(value).__name__,
                )
            except json.JSONDecodeError as exc:
                logging.info(
                    "Invoke JSON arg coercion skipped; value is not valid JSON. key=%s raw=%r error=%s",
                    key,
                    raw_value,
                    exc,
                )
                return raw_value

        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as exc:
            logging.warning(
                "Invoke JSON arg is not JSON-serializable. key=%s value_type=%s value=%r error=%s",
                key,
                type(value).__name__,
                value,
                exc,
            )
            raise ValueError(f"Invoke JSON argument '{key}' is not JSON-serializable.") from exc

        return value

    def get_input_form(self) -> dict[str, dict]:
        res = {}
        for item in self._param.variables or []:
            if not isinstance(item, dict):
                continue
            ref = (item.get("ref") or "").strip()
            if not ref or ref in res:
                continue

            elements = self.get_input_elements_from_text("{" + ref + "}")
            element = elements.get(ref, {})
            res[ref] = {
                "type": "line",
                "name": element.get("name") or item.get("key") or ref,
            }
        return res

    def _resolve_variable_value(self, variable_name: str, kwargs: dict | None = None):
        kwargs = kwargs or {}
        value = kwargs.get(variable_name, self._canvas.get_variable_value(variable_name))
        if isinstance(value, partial):
            value = "".join(value())
            self.set_input_value(variable_name, value)
        return "" if value is None else value

    def _render_template(self, content: str, pattern: str, kwargs: dict | None = None, *, flags: int = 0) -> str:
        content = content or ""
        if not content:
            return content

        def replace_variable(match_obj):
            return str(self._resolve_variable_value(match_obj.group(1), kwargs))

        return re.sub(pattern, replace_variable, content, flags=flags)

    def _resolve_template_text(self, content: str, kwargs: dict | None = None) -> str:
        return self._render_template(content, self.variable_ref_patt, kwargs, flags=re.DOTALL)

    def _resolve_header_text(self, content: str, kwargs: dict | None = None) -> str:
        # Headers support plain {token} placeholders, so they cannot reuse the canvas variable regex.
        return self._render_template(content, self.header_variable_ref_patt, kwargs)

    def _resolve_arg_value(self, para: dict, kwargs: dict) -> object:
        ref = (para.get("ref") or "").strip()
        if ref and (ref in kwargs or self._canvas.get_variable_value(ref) is not None):
            return self._resolve_variable_value(ref, kwargs)

        if para.get("value") is not None:
            value = para["value"]
            if isinstance(value, str):
                return self._resolve_template_text(value, kwargs)
            return value

        if ref:
            return self._resolve_variable_value(ref, kwargs)

        return ""

    def _is_json_mode(self) -> bool:
        return self._param.datatype.lower() == "json"

    def _build_request_args(self, kwargs: dict) -> dict:
        args = {}
        for para in self._param.variables:
            key = para["key"]
            value = self._resolve_arg_value(para, kwargs)
            if self._is_json_mode():
                # JSON mode accepts stringified JSON so complex payloads can be passed through variables.
                value = self._coerce_json_arg_if_possible(key, value)
            args[key] = value

            if para.get("ref"):
                self.set_input_value(para["ref"], value)
        return args

    def _build_url(self, kwargs: dict) -> str:
        url = self._resolve_template_text(self._param.url.strip(), kwargs)
        if not url.startswith(("http://", "https://")):
            url = "http://" + url
        hostname, ip = assert_url_is_safe(url)
        self._pinned_hostname = hostname
        self._pinned_ip = ip
        return url

    def _build_headers(self, kwargs: dict) -> dict:
        if not self._param.headers:
            return {}

        headers = json.loads(self._param.headers)
        if not isinstance(headers, dict):
            raise ValueError("Invoke headers must be a JSON object.")

        return {key: self._resolve_header_text(value, kwargs) if isinstance(value, str) else value for key, value in headers.items()}

    @staticmethod
    def _ssrf_log_target(url: str) -> str:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.hostname:
            return "invalid-url"
        return f"{parsed.scheme}://{parsed.hostname}"

    def _normalize_proxy_url(self) -> str | None:
        proxy = (self._param.proxy or "").strip()
        if not re.sub(r"https?:?/?/?", "", proxy):
            return None
        if not proxy.startswith(("http://", "https://")):
            proxy = "http://" + proxy
        return proxy

    def _build_proxies(self) -> dict | None:
        proxy_url = self._normalize_proxy_url()
        if not proxy_url:
            return None
        return {"http": self._param.proxy, "https": self._param.proxy}

    def _send_request(self, url: str, args: dict, headers: dict, proxies: dict | None):
        method = self._param.method.lower()
        request = getattr(requests, method)
        request_kwargs = {
            "url": url,
            "headers": headers,
            "proxies": proxies,
            "timeout": self._param.timeout,
            "allow_redirects": False,
        }

        # GET sends query params; POST/PUT send either JSON or form data based on datatype.
        if method == "get":
            request_kwargs["params"] = args
            return request(**request_kwargs)

        body_key = "json" if self._is_json_mode() else "data"
        request_kwargs[body_key] = args
        return request(**request_kwargs)

    def _format_response(self, response) -> str:
        if not self._param.clean_html:
            return response.text

        # HtmlParser keeps the Invoke output text-focused when the endpoint returns HTML.
        sections = HtmlParser()(None, response.content)
        return "\n".join(sections)

    @timeout(int(os.environ.get("COMPONENT_EXEC_TIMEOUT", 3)))
    def _invoke(self, **kwargs):
        if self.check_if_canceled("Invoke processing"):
            return

        args = self._build_request_args(kwargs)
        headers = self._build_headers(kwargs)
        proxies = self._build_proxies()
        proxy_hostname = proxy_ip = None

        if proxies:
            proxy_url = self._normalize_proxy_url()
            try:
                proxy_hostname, proxy_ip = assert_url_is_safe(proxy_url)
            except ValueError as exc:
                logging.warning(
                    "Invoke SSRF guard blocked proxy=%s: %s",
                    self._ssrf_log_target(proxy_url),
                    exc,
                )
                self.set_output("_ERROR", "URL not valid")
                return "Http request error: URL not valid"

        last_error = None
        for _ in range(self._param.max_retries + 1):
            if self.check_if_canceled("Invoke processing"):
                return

            try:
                url = self._build_url(kwargs)
                if not self._pinned_hostname or not self._pinned_ip:
                    raise ValueError("Invoke URL was not validated before request.")
                with pin_dns(self._pinned_hostname, self._pinned_ip):
                    if proxy_hostname and proxy_ip:
                        with pin_dns(proxy_hostname, proxy_ip):
                            response = self._send_request(url, args, headers, proxies)
                    else:
                        response = self._send_request(url, args, headers, proxies)
                result = self._format_response(response)
                self.set_output("result", result)
                return result
            except ValueError as e:
                logging.warning(
                    "Invoke SSRF guard blocked url=%s: %s",
                    self._ssrf_log_target(locals().get("url", self._param.url)),
                    e,
                )
                self.set_output("_ERROR", "URL not valid")
                return "Http request error: URL not valid"
            except Exception as e:
                if self.check_if_canceled("Invoke processing"):
                    return

                last_error = e
                logging.exception(f"Http request error: {e}")
                time.sleep(self._param.delay_after_error)

        if last_error:
            self.set_output("_ERROR", str(last_error))
            return f"Http request error: {last_error}"

    def thoughts(self) -> str:
        return "Waiting for the server respond..."
