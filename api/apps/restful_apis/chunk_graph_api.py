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
"""Deterministic chunk graph (relationship + structure) endpoints.

Unlike GraphRAG these endpoints never call an LLM. They read the parsed chunks
of a dataset and derive layers that always exist:

    document -> chapter/section/article -> chunk -> sentence
    chunk -> keyword

That makes the knowledge-graph page useful on CPU-only deployments where
entity extraction is impractically slow, while GraphRAG keeps working as the
optional entity graph.
"""
import logging
import re

from quart import request

from api.apps import login_required
from api.db.db_models import Document
from api.db.services.document_service import DocumentService
from api.db.services.knowledgebase_service import KnowledgebaseService
from api.utils.api_utils import add_tenant_id_to_kwargs, get_error_data_result, get_result
from common import settings
from rag.chunk_graph import build_graph, clean

WHITESPACE_RE = re.compile(r"\s+")


def _clean(text):
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    return WHITESPACE_RE.sub(" ", text).strip()


def _dataset_documents(dataset_id, doc_ids):
    query = Document.select().where(Document.kb_id == dataset_id)
    if doc_ids:
        query = query.where(Document.id.in_(doc_ids))
    return [d for d in query.order_by(Document.create_time.asc())]


def _chunk_payload(chunk_id, field):
    page = field.get("page_num_int", 0)
    if isinstance(page, list):
        page = page[0] if page else 0
    return {
        "id": chunk_id,
        "content": _clean(field.get("content_with_weight", "")),
        "doc_id": field.get("doc_id", ""),
        "doc_name": field.get("docnm_kwd", ""),
        "order": field.get("chunk_order_int", 0) or 0,
        "page": page or 0,
        "important": field.get("important_kwd") or [],
        "positions": field.get("position_int") or [],
    }


async def _load_chunks(dataset_id, dataset_tenant_id, doc_id, max_chunks):
    from rag.nlp import search as search_mod

    index_name = search_mod.index_name(dataset_tenant_id)
    if not settings.docStoreConn.index_exist(index_name, dataset_id):
        return []
    query = {
        "doc_ids": [doc_id],
        "page": 1,
        "size": min(max(max_chunks, 1), 1024),
        "question": "",
        "sort": True,
        "must_not": {"exists": "compile_kwd"},
        "fields": [
            "docnm_kwd",
            "content_with_weight",
            "doc_id",
            "chunk_order_int",
            "page_num_int",
            "position_int",
            "important_kwd",
            "available_int",
        ],
    }
    sres = await settings.retriever.search(
        query, index_name, [dataset_id], emb_mdl=None, highlight=False
    )
    chunks = []
    for cid in sres.ids:
        field = sres.field.get(cid) or {}
        if not _clean(field.get("content_with_weight", "")):
            continue
        chunks.append(_chunk_payload(cid, field))
    chunks.sort(key=lambda c: (c["order"], c["id"]))
    return chunks


async def _chunk_graph(dataset_id, doc_ids, max_chunks, granularity):
    ok, kb = KnowledgebaseService.get_by_id(dataset_id)
    if not ok:
        return get_error_data_result(message=f"You don't own the dataset {dataset_id}.")
    raw_docs = _dataset_documents(dataset_id, doc_ids)
    if not raw_docs:
        return get_error_data_result(message="No documents found in this dataset.")
    docs = [
        {"id": d.id, "name": d.name, "parser_id": d.parser_id}
        for d in raw_docs
    ]
    chunks_by_doc = {}
    for doc in docs:
        chunks_by_doc[doc["id"]] = await _load_chunks(
            dataset_id, kb.tenant_id, doc["id"], max_chunks
        )
    data = build_graph(docs, chunks_by_doc, granularity)
    data["dataset_id"] = dataset_id
    return get_result(data=data)


def _parse_request():
    req = request.args
    raw_docs = req.get("doc_ids", "")
    doc_ids = [d.strip() for d in raw_docs.split(",") if d.strip()]
    try:
        max_chunks = int(req.get("max_chunks", 200))
    except (TypeError, ValueError):
        max_chunks = 200
    granularity = (req.get("granularity") or "sentence").lower()
    if granularity not in ("chunk", "sentence"):
        granularity = "sentence"
    return doc_ids, max_chunks, granularity


@manager.route("/datasets/<dataset_id>/chunk-graph", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def get_dataset_chunk_graph(tenant_id, dataset_id):
    if not KnowledgebaseService.accessible(kb_id=dataset_id, user_id=tenant_id):
        return get_error_data_result(message=f"You don't own the dataset {dataset_id}.")
    doc_ids, max_chunks, granularity = _parse_request()
    try:
        return await _chunk_graph(dataset_id, doc_ids, max_chunks, granularity)
    except Exception as e:
        logging.exception("chunk graph failed: %s", e)
        return get_error_data_result(message=f"Failed to build chunk graph: {e}")


@manager.route("/datasets/<dataset_id>/documents/<document_id>/chunk-graph", methods=["GET"])  # noqa: F821
@login_required
@add_tenant_id_to_kwargs
async def get_document_chunk_graph(tenant_id, dataset_id, document_id):
    if not KnowledgebaseService.accessible(kb_id=dataset_id, user_id=tenant_id):
        return get_error_data_result(message=f"You don't own the dataset {dataset_id}.")
    doc = DocumentService.query(id=document_id, kb_id=dataset_id)
    if not doc:
        return get_error_data_result(message=f"You don't own the document {document_id}.")
    _, max_chunks, granularity = _parse_request()
    try:
        return await _chunk_graph(dataset_id, [document_id], max_chunks, granularity)
    except Exception as e:
        logging.exception("document chunk graph failed: %s", e)
        return get_error_data_result(message=f"Failed to build chunk graph: {e}")
