"""Inspector tools: operate on already-returned results."""

import logging
from copy import deepcopy

_LOG = logging.getLogger(__name__)

"""
1. 查看一个 chunk 的上下文(按召回的上下滑动窗口)
函数：open_context

作用：

根据某个 chunk_id，在当前已检索到的结果里找到它的位置
自动扩展前后相邻的 chunk
返回一个更完整的局部上下文窗口
这个很像“打开一段上下文”，方便模型在精确证据附近继续判断，而不是只看单条 chunk。

2. 对比多个来源
函数：compare_sources

作用：

输入多个 chunk_id
从当前 kbinfos 里找到对应 chunk
汇总这些 chunk 来自哪些文档
返回包含这些来源信息的结果
它适合用来判断：

这些信息是不是来自不同文档
证据是否分散
来源是否一致
3. 在单个文档中按关键词筛查
函数：grep_within

作用：

指定 doc_id 和 pattern
只在该文档内查找关键词
再调用搜索模块里的关键词裁剪逻辑，保留命中句子及其邻接句子
返回更聚焦的证据段
这个功能非常适合：

“我已经知道这个文档可能是对的，但只想看与关键词相关的那一段”
对文档内做局部精读
4. 获取相邻 chunk
函数：request_adjacent

作用：

给定一个 chunk_id
读取它前一个或后一个方向的相邻 chunk
可设置 count 控制扩充数量
它更像“往前/往后继续看证据”，适合做上下文连续追踪。

这是一个什么层次的工具
它是 RAG 流程中的“二次检查层”：

第一步：检索找证据 → search.py
第二步：导航定位相关文档/结构 → navigation.py
第三步：在已有结果上做细查与扩展 → inspector.py
"""
async def open_context(tools, chunk_id: str, width: int = 500) -> dict:
    """Expand context around a chunk by looking up adjacent chunks in kbinfos."""
    chunks = tools.kbinfos.get("chunks", [])
    idx = _find_chunk_index(chunks, chunk_id)
    if idx is None:
        return {"chunks": [], "doc_aggs": []}
    start = max(0, idx - 2)
    end = min(len(chunks), idx + 2)
    context = chunks[start:end]
    _LOG.info("open_context: chunk=%s index=%d context=%d chunks", chunk_id, idx, len(context))
    return {"chunks": context, "doc_aggs": _collect_doc_aggs(tools, context)}


async def compare_sources(tools, chunk_ids: list[str]) -> dict:
    """Find chunks in kbinfos and list the document sources they come from."""
    if not chunk_ids:
        return {"chunks": [], "doc_aggs": []}
    chunks = tools.kbinfos.get("chunks", [])
    matched = [c for c in chunks if _chunk_id(c) in chunk_ids]
    return {"chunks": matched, "doc_aggs": _collect_doc_aggs(tools, matched)}


async def grep_within(tools, doc_id: str, pattern: str) -> dict:
    """Find a keyword within a document and return its chunks narrowed to the
    matching sentences (+/- 1 neighbour).

    ``pattern`` is treated as the keyword string (comma-separate for several).
    Delegates to :func:`_narrow_by_keywords`, which keeps only keyword-bearing
    sentences and drops chunks with no match. Operates on copies so the shared
    ``kbinfos`` citation pool is never mutated.
    """
    from rag.advanced_rag.harness.tools.search import _narrow_by_keywords

    chunks = [deepcopy(c) for c in tools.kbinfos.get("chunks", []) if c.get("doc_id") == doc_id]
    matched = _narrow_by_keywords(chunks, pattern)
    return {"chunks": matched, "doc_aggs": _collect_doc_aggs(tools, matched)}


async def request_adjacent(tools, chunk_id: str, direction: str = "next", count: int = 3) -> dict:
    """Get adjacent entries before or after a chunk."""
    chunks = tools.kbinfos.get("chunks", [])
    idx = _find_chunk_index(chunks, chunk_id)
    if idx is None:
        return {"chunks": [], "doc_aggs": []}

    if direction == "prev":
        start = max(0, idx - count)
        end = idx
    else:
        start = idx + 1
        end = min(len(chunks), start + count)

    adjacent = chunks[start:end]
    return {"chunks": adjacent, "doc_aggs": _collect_doc_aggs(tools, adjacent)}


# Helpers


def _find_chunk_index(chunks: list[dict], chunk_id: str) -> int | None:
    for i, c in enumerate(chunks):
        if _chunk_id(c) == chunk_id:
            return i
    return None


def _chunk_id(ck: dict) -> str:
    return str(ck.get("chunk_id") or ck.get("id") or "")


def _collect_doc_aggs(tools, chunks: list[dict]) -> list[dict]:
    seen = set()
    aggs = []
    for c in chunks:
        doc_id = c.get("doc_id")
        if doc_id and doc_id not in seen:
            seen.add(doc_id)
            aggs.append({"doc_id": doc_id, "doc_name": c.get("docnm_kwd", "")})
    return aggs
