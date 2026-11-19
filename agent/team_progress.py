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
"""AgentTeam 运行期进度通道。

多智能体团队执行时每分发一个子任务都会在这里登记一条进度记录（开始/结束），
前端可以轮询 `GET /api/v1/agents/team-progress/<task_id>` 把"任务分发看板"
渲染成分发中的实时状态，而不必等到整张画布跑完。

设计约束：
- 只写 Redis，且所有异常都必须被吞掉：进度上报失败绝不能影响真正的协作执行。
- 一次运行（task_id 即 Canvas.task_id，等于前端传入的 session_id）共用一个 key，
  条目以 hash field 形式存储，天然支持并发 worker 的 upsert，无需加锁。
- 数据是临时的，默认 30 分钟过期。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Mapping
from uuid import uuid4

_logger = logging.getLogger(__name__)

KEY_PREFIX = "agent-team-progress-"
PROGRESS_TTL_SECONDS = 60 * 30
RESULT_PREVIEW_CHARS = 800


def progress_key(task_id: str) -> str:
    return f"{KEY_PREFIX}{task_id}"


def _client():
    try:
        # 延迟导入：rag.utils.redis_conn 与 common.settings 互相 import，必须先
        # 导入 settings 才能安全拿到 REDIS_CONN（否则循环导入）。
        from common import settings  # noqa: F401
        from rag.utils.redis_conn import REDIS_CONN

        if not REDIS_CONN.is_alive():
            return None
        return REDIS_CONN.REDIS
    except Exception:
        _logger.exception("[AgentTeam] redis is not reachable for team progress")
        return None


def reset_progress(task_id: str) -> None:
    """一次新的运行开始前清掉上一轮的看板数据。"""
    if not task_id:
        return
    client = _client()
    if client is None:
        return
    try:
        client.delete(progress_key(task_id))
    except Exception:
        _logger.exception("[AgentTeam] failed to reset team progress for %s", task_id)


def _write(client, task_id: str, entry_id: str, entry: Mapping[str, Any]) -> None:
    key = progress_key(task_id)
    client.hset(key, entry_id, json.dumps(entry, ensure_ascii=False))
    client.expire(key, PROGRESS_TTL_SECONDS)


def record_start(
    task_id: str,
    *,
    component_id: str,
    worker_id: str,
    worker_name: str = "",
    role: str = "participant",
    task: str = "",
    process: str = "",
    round_index: int = 0,
    task_index: int = 0,
    sequence: int = 0,
    context: str = "",
) -> str:
    """登记一条"分发中"的记录，返回条目 id 供 :func:`record_finish` 回填。"""
    entry_id = uuid4().hex
    if not task_id:
        return entry_id
    client = _client()
    if client is None:
        return entry_id
    entry = {
        "id": entry_id,
        "component_id": component_id,
        "worker_id": worker_id,
        "worker_name": worker_name,
        "role": role,
        "task": task,
        "context": context,
        "process": process,
        "round": int(round_index or 0),
        "task_index": int(task_index or 0),
        "sequence": int(sequence or 0),
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "elapsed_ms": None,
        "error": "",
        "result": "",
    }
    try:
        _write(client, task_id, entry_id, entry)
    except Exception:
        _logger.exception("[AgentTeam] failed to record delegation start for %s", task_id)
    return entry_id


def record_finish(
    task_id: str,
    entry_id: str,
    *,
    status: str,
    result: str = "",
    error: str = "",
    elapsed_ms: int = 0,
) -> None:
    """把一条"分发中"的记录改写为最终状态。"""
    if not task_id or not entry_id:
        return
    client = _client()
    if client is None:
        return
    key = progress_key(task_id)
    try:
        raw = client.hget(key, entry_id)
        if not raw:
            return
        payload = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        entry = json.loads(payload)
        entry["status"] = status
        entry["result"] = (result or "")[:RESULT_PREVIEW_CHARS]
        entry["error"] = error or ""
        entry["elapsed_ms"] = int(elapsed_ms or 0)
        entry["finished_at"] = time.time()
        _write(client, task_id, entry_id, entry)
    except Exception:
        _logger.exception("[AgentTeam] failed to record delegation finish for %s", task_id)


def read_progress(task_id: str) -> list[dict[str, Any]]:
    """按开始时间升序返回一次运行的分发记录。"""
    if not task_id:
        return []
    client = _client()
    if client is None:
        return []
    try:
        raw = client.hgetall(progress_key(task_id))
    except Exception:
        _logger.exception("[AgentTeam] failed to read team progress for %s", task_id)
        return []
    entries: list[dict[str, Any]] = []
    for value in raw.values():
        try:
            text = value.decode("utf-8") if isinstance(value, bytes) else value
            entries.append(json.loads(text))
        except Exception:
            continue
    entries.sort(key=lambda item: (float(item.get("started_at") or 0), int(item.get("sequence") or 0)))
    return entries
