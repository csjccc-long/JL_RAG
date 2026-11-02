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

"""将选定的内部 INFO 级别日志作为 <think> 内容暴露给客户端。

在 agentic rag_agent 轮次中，我们附加了一个上下文作用域的日志接收器（sink），
以便将管道中带有括号标记的进度日志——如 [Agentic RAG]、[Formalizing the question]、[Preliminary search]、[Planner]、[Orchestrator]、[Agentic research]、[Hybrid search]、[BM25 search]、[Web search]、[Composing the answer]、[Tool loop]、[Function tool] 等——作为推理过程流式传输到前端，而无需在每个调用点进行埋点。这些标记同时充当了人类可读的阶段标签，因此同一条消息既可用于后端日志，也可用于面向用户的思考流。

该接收器存储在一个 :class:contextvars.ContextVar 中，因此只有当前请求的异步任务树（继承了该上下文）会转发其日志——并发请求之间保持隔离。从 thread_pool_exec 工作线程发出的、未继承该上下文的日志将被直接跳过。
"""

from __future__ import annotations

import contextvars
import logging
from typing import Callable

# Per-request sink: a callable(str) that forwards one log line, or None when no
# agentic turn is streaming in the current context.
_think_log_sink: contextvars.ContextVar[Callable[[str], None] | None] = contextvars.ContextVar("think_log_sink", default=None)

# Only bracket-tagged INFO lines from these logger namespaces are surfaced.
_SCOPED_PREFIXES = ("rag.advanced_rag", "rag.llm.chat_model", "rag.llm.tool_decorator")

_installed = False


class ThinkLogHandler(logging.Handler):
    """Forward in-scope, bracket-tagged records to the active per-request sink."""

    def emit(self, record: logging.LogRecord) -> None:
        sink = _think_log_sink.get()
        if sink is None:
            return
        name = record.name or ""
        if not name.startswith(_SCOPED_PREFIXES):
            return
        try:
            msg = record.getMessage()
        except Exception:
            return
        # Only the bracket-tagged progress lines ("[Hybrid search] ...").
        if not msg or not msg.lstrip().startswith("["):
            return
        try:
            sink("<br>" + msg.strip())
        except Exception:
            # Never let think-log forwarding break the request or the logging
            # subsystem itself.
            pass


def install_think_log_handler() -> None:
    """Install the forwarding handler on the root logger exactly once."""
    global _installed
    if _installed:
        return
    handler = ThinkLogHandler(level=logging.INFO)
    logging.getLogger().addHandler(handler)
    _installed = True


def set_think_log_sink(sink: Callable[[str], None] | None):
    """Activate ``sink`` for the current context; returns the reset token."""
    return _think_log_sink.set(sink)


def reset_think_log_sink(token) -> None:
    try:
        _think_log_sink.reset(token)
    except Exception:
        pass
