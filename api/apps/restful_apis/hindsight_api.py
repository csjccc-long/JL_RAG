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
"""Management API for the opt-in Hindsight memory mode.

The engine is in-process (memory/hindsight/), so these routes are not a proxy:
each one calls the store or one of the algorithms and renders its result. The
console and the API therefore share one source of truth, and the bank name in
the URL is scoped to the calling tenant.

Expensive calls (retain, reflect, consolidate, mental-model refresh) go through
the tenant's own chat model; everything else is local SQLite work.
"""

import inspect
import logging
import secrets

from quart import request

from api.apps import current_user, login_required
from api.utils.api_utils import get_json_result, get_request_json
from common.constants import RetCode
from memory.hindsight import ingest as ingest_files
from memory.hindsight import webhooks as webhook_events
from memory.hindsight.extract import EXTRACTION_SYSTEM, extract_facts
from memory.router import get_memory_router


def _backend():
    return get_memory_router().hindsight


def _engine():
    return _backend().engine


def _tenant() -> str:
    return str(current_user.id)


def _bank(bank_id: str) -> str:
    return bank_id or get_memory_router().settings.hindsight.bank


def _params() -> dict:
    return {key: value for key, value in request.args.items()}


def _int_param(name: str, default: int, *, low: int = 1, high: int = 500) -> int:
    try:
        value = int(_params().get(name) or default)
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


async def _body() -> dict:
    try:
        data = await get_request_json()
    except Exception:  # noqa: BLE001 - DELETE/POST calls are allowed an empty body
        return {}
    return data if isinstance(data, dict) else {}


def _result(data):
    return get_json_result(data=data)


def _failure(message: str, *, detail: str = ""):
    if detail:
        logging.warning("hindsight: %s (%s)", message, detail)
    return get_json_result(code=RetCode.SERVER_ERROR, message=message)


# -- status / banks -------------------------------------------------------


@manager.route("/hindsight/status", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_status():
    settings = get_memory_router().settings.hindsight
    status = get_memory_router().hindsight.status()
    status.update({
        "enabled": True,
        "db_path": status.get("db_path") or settings.db_path,
        "bank": settings.bank,
        "budget": settings.budget,
        "max_tokens": settings.max_tokens,
        "top_k": settings.top_k,
        "retain_async": settings.retain_async,
        "prefer_observations": settings.prefer_observations,
        "healthy": bool(status.get("healthy")),
        "error": status.get("error") or "",
    })
    # The engine knows the index name only once a tenant is in scope; without
    # one describe() reports the pattern (hindsight_<tenant>) instead.
    try:
        status["vector_index"] = _engine().vector_index.describe(_tenant()).get(
            "index", status.get("vector_index", ""))
    except Exception:  # noqa: BLE001 - a status read never fails a page
        pass
    return _result(status)


@manager.route("/hindsight/banks", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_banks():
    return _result({"banks": _engine().banks(_tenant())})


@manager.route("/hindsight/banks", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_create_bank():
    body = await _body()
    name = str(body.get("name") or "").strip()
    bank_id = str(body.get("bank_id") or name).strip()
    if not bank_id:
        return get_json_result(code=RetCode.BAD_REQUEST, message="bank_id is required")
    _engine().create_bank(_tenant(), bank_id, name=name or bank_id)
    return _result({"id": bank_id, "name": name or bank_id})


@manager.route("/hindsight/banks/<bank_id>", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_bank(bank_id):
    bank = _engine().store.get_bank(_tenant(), _bank(bank_id))
    if bank is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="bank not found")
    return _result(bank)


@manager.route("/hindsight/banks/<bank_id>", methods=["PATCH", "PUT"])  # noqa: F821
@login_required
async def hindsight_update_bank(bank_id):
    body = await _body()
    _engine().store.patch_bank(
        _tenant(), _bank(bank_id),
        name=str(body["name"]) if "name" in body else None,
        mission=str(body["mission"]) if "mission" in body else None,
        config=body.get("config") if isinstance(body.get("config"), dict) else None,
    )
    return _result(_engine().store.get_bank(_tenant(), _bank(bank_id)))


@manager.route("/hindsight/banks/<bank_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_bank(bank_id):
    _engine().delete_bank(_tenant(), _bank(bank_id))
    return _result({"deleted": True})


@manager.route("/hindsight/banks/<bank_id>/config", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_config(bank_id):
    settings = get_memory_router().settings.hindsight
    bank = _engine().store.get_bank(_tenant(), _bank(bank_id)) or {}
    return _result({
        "bank": _bank(bank_id),
        "name": bank.get("name") or settings.bank,
        "mission": bank.get("mission") or "",
        "config": bank.get("config") or {},
        "effective": {
            "budget": settings.budget,
            "max_tokens": settings.max_tokens,
            "top_k": settings.top_k,
            "defense": settings.defense,
            "consolidate_after": settings.consolidate_after,
        },
    })


@manager.route("/hindsight/banks/<bank_id>/config", methods=["PATCH"])  # noqa: F821
@login_required
async def hindsight_patch_config(bank_id):
    body = await _body()
    _engine().store.patch_bank(
        _tenant(), _bank(bank_id),
        name=str(body["name"]) if "name" in body else None,
        mission=str(body["mission"]) if "mission" in body else None,
        config=body.get("config") if isinstance(body.get("config"), dict) else None,
    )
    return _result({"bank": _bank(bank_id), "updated": True})


@manager.route("/hindsight/banks/<bank_id>/stats", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_stats(bank_id):
    return _result(_engine().stats(_tenant(), _bank(bank_id)))


@manager.route("/hindsight/banks/<bank_id>/tags", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_tags(bank_id):
    return _result({"tags": _engine().tags(_tenant(), _bank(bank_id))})


# -- retain / recall ------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/memories", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_retain(bank_id):
    body = await _body()
    items = body.get("items")
    if not isinstance(items, list):
        content = str(body.get("content") or body.get("text") or "")
        # Carry the caller's document id/tags through: a single-content retain is
        # the same document as its list form, not an anonymous one.
        items = [{
            "content": content,
            "document_id": body.get("document_id"),
            "tags": body.get("tags"),
            "timestamp": body.get("timestamp"),
        }] if content else []
    providers = get_memory_router().hindsight.providers(_tenant())
    results = []
    for item in items:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or item.get("text") or "").strip()
        if not content:
            continue
        tags = item.get("tags") or body.get("tags") or []
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
        results.append(await _engine().retain(
            _tenant(), _bank(bank_id), content,
            document_id=str(item.get("document_id") or ""),
            tags=tags,
            metadata={"timestamp": item.get("timestamp")},
            providers=providers,
            today=item.get("timestamp"),
        ))
    stored = sum(int(result.get("stored") or 0) for result in results)
    return _result({"results": results, "stored": stored})


@manager.route("/hindsight/banks/<bank_id>/memories/list", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_list_memories(bank_id):
    kind = _params().get("kind") or None
    limit = _int_param("limit", 50, high=1000)
    return _result({"memories": _engine().memories(_tenant(), _bank(bank_id), kind=kind, limit=limit)})


@manager.route("/hindsight/banks/<bank_id>/memories/recall", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_recall(bank_id):
    body = await _body()
    query = str(body.get("query") or "").strip()
    if not query:
        return get_json_result(code=RetCode.BAD_REQUEST, message="query is required")
    tags = body.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
    outcome = await _engine().recall(
        _tenant(), _bank(bank_id), query,
        providers=get_memory_router().hindsight.providers(_tenant()),
        limit=int(body.get("limit") or get_memory_router().settings.hindsight.top_k),
        max_tokens=int(body.get("max_tokens") or get_memory_router().settings.hindsight.max_tokens),
        types=body.get("types") or (),
        tags=tags,
        tags_match=str(body.get("tags_match") or "any"),
        prefer_observations=bool(body.get("prefer_observations", False)),
        temporal_window=body.get("temporal_window") if isinstance(body.get("temporal_window"), dict) else None,
        query_timestamp=body.get("query_timestamp") or None,
        trace=bool(body.get("trace", False)),
    )
    payload = {"results": outcome.results, "total": len(outcome.results)}
    if body.get("trace"):
        payload["trace"] = outcome.trace
    return _result(payload)


@manager.route("/hindsight/banks/<bank_id>/memories/dry-run-extract", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_dry_run_extract(bank_id):
    body = await _body()
    text = str(body.get("text") or body.get("content") or "").strip()
    if not text:
        return get_json_result(code=RetCode.BAD_REQUEST, message="text is required")
    providers = get_memory_router().hindsight.providers(_tenant())
    facts = await extract_facts(providers, text, context=str(body.get("context") or ""),
                                today=body.get("today"))
    return _result({"facts": [fact.to_dict() for fact in facts]})


@manager.route("/hindsight/banks/<bank_id>/memories/<memory_id>", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_memory(bank_id, memory_id):
    unit = _engine().get_memory(_tenant(), _bank(bank_id), memory_id)
    if unit is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="memory not found")
    return _result(unit.to_dict())


@manager.route("/hindsight/banks/<bank_id>/memories/<memory_id>", methods=["PATCH"])  # noqa: F821
@login_required
async def hindsight_update_memory(bank_id, memory_id):
    body = await _body()
    unit = _engine().get_memory(_tenant(), _bank(bank_id), memory_id)
    if unit is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="memory not found")
    fields = {}
    if "text" in body and str(body["text"]).strip():
        fields["text"] = str(body["text"]).strip()
    if "tags" in body and isinstance(body["tags"], list):
        fields["tags"] = body["tags"]
    if fields:
        _engine().store.update_unit(memory_id, **fields)
    updated = _engine().get_memory(_tenant(), _bank(bank_id), memory_id)
    return _result(updated.to_dict() if updated else {})


@manager.route("/hindsight/banks/<bank_id>/memories/<memory_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_memory(bank_id, memory_id):
    deleted = _engine().delete_memory(_tenant(), _bank(bank_id), memory_id)
    if not deleted:
        return get_json_result(code=RetCode.NOT_FOUND, message="memory not found")
    return _result({"deleted": True})


@manager.route("/hindsight/banks/<bank_id>/memories/<memory_id>/history", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_memory_history(bank_id, memory_id):
    return _result({"history": _engine().memory_history(_tenant(), _bank(bank_id), memory_id)})


@manager.route("/hindsight/banks/<bank_id>/prompts/preview", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_prompt_preview(bank_id):
    bank = _engine().store.get_bank(_tenant(), _bank(bank_id)) or {}
    return _result({
        "prompt": EXTRACTION_SYSTEM,
        "mission": bank.get("mission") or "",
        "directives": [item["content"] for item in _engine().directives(_tenant(), _bank(bank_id))],
    })


# -- reflect --------------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/reflect", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_reflect(bank_id):
    body = await _body()
    query = str(body.get("query") or "").strip()
    if not query:
        return get_json_result(code=RetCode.BAD_REQUEST, message="query is required")
    tags = body.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
    try:
        result = await _engine().reflect(
            _tenant(), _bank(bank_id), query,
            providers=get_memory_router().hindsight.providers(_tenant()),
            limit=int(body.get("limit") or 6),
            max_tokens=int(body.get("max_tokens") or get_memory_router().settings.hindsight.max_tokens),
            tags=tags,
        )
    except Exception as exc:  # noqa: BLE001 - a failed reflection is not a 500 page
        logging.exception("hindsight reflect failed")
        return _failure(f"Reflect failed: {exc}")
    return _result(result)


# -- observations / consolidation ----------------------------------------


@manager.route("/hindsight/banks/<bank_id>/observations/tree", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_observations(bank_id):
    return _result(_engine().observations(_tenant(), _bank(bank_id)))


@manager.route("/hindsight/banks/<bank_id>/observations/scopes", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_observation_scopes(bank_id):
    return _result({"scopes": _engine().observation_scopes(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/observations", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_clear_observations(bank_id):
    scope = str((await _body()).get("scope") or "")
    removed = _engine().clear_observations(_tenant(), _bank(bank_id), scope=scope)
    return _result({"removed": removed})


@manager.route("/hindsight/banks/<bank_id>/consolidate", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_consolidate(bank_id):
    body = await _body()
    result = await _engine().consolidate(
        _tenant(), _bank(bank_id),
        providers=get_memory_router().hindsight.providers(_tenant()),
        dry_run=bool(body.get("dry_run", False)),
        tags=body.get("tags") or (),
    )
    return _result(result)


@manager.route("/hindsight/banks/<bank_id>/consolidation-strategies/preview", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_consolidation_preview(bank_id):
    body = await _body()
    result = await _engine().consolidate(
        _tenant(), _bank(bank_id),
        providers=get_memory_router().hindsight.providers(_tenant()),
        dry_run=True,
        tags=body.get("tags") or (),
    )
    return _result(result)


# -- mental models --------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/mental-models", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_mental_models(bank_id):
    return _result({"mental_models": _engine().mental_models(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/mental-models", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_create_mental_model(bank_id):
    body = await _body()
    source_query = str(body.get("source_query") or body.get("query") or "").strip()
    if not source_query:
        return get_json_result(code=RetCode.BAD_REQUEST, message="source_query is required")
    model = await _engine().create_mental_model(
        _tenant(), _bank(bank_id),
        name=str(body.get("name") or "").strip() or source_query[:60],
        source_query=source_query,
        max_tokens=int(body.get("max_tokens") or 600),
        providers=get_memory_router().hindsight.providers(_tenant()),
    )
    return _result(model)


@manager.route("/hindsight/banks/<bank_id>/mental-models/<model_id>", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_mental_model(bank_id, model_id):
    model = _engine().store.get_mental_model(_tenant(), _bank(bank_id), model_id)
    if model is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="mental model not found")
    return _result(model)


@manager.route("/hindsight/banks/<bank_id>/mental-models/<model_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_mental_model(bank_id, model_id):
    _engine().delete_mental_model(_tenant(), _bank(bank_id), model_id)
    return _result({"deleted": True})


@manager.route("/hindsight/banks/<bank_id>/mental-models/<model_id>/refresh", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_refresh_mental_model(bank_id, model_id):
    model = await _engine().refresh_mental_model(
        _tenant(), _bank(bank_id), model_id,
        providers=get_memory_router().hindsight.providers(_tenant()),
    )
    if not model:
        return get_json_result(code=RetCode.NOT_FOUND, message="mental model not found")
    return _result(model)


@manager.route("/hindsight/banks/<bank_id>/mental-models/<model_id>/clear", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_clear_mental_model(bank_id, model_id):
    model = _engine().store.get_mental_model(_tenant(), _bank(bank_id), model_id)
    if model is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="mental model not found")
    cleared = _engine().store.upsert_mental_model(
        _tenant(), _bank(bank_id), model_id,
        name=model["name"], source_query=model["source_query"], content="",
        max_tokens=int(model.get("max_tokens") or 600),
    )
    return _result(cleared)


# -- pages ----------------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/mental-models/<model_id>/history", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_mental_model_history(bank_id, model_id):
    entries = [
        entry for entry in _engine().audit_logs(_tenant(), _bank(bank_id), limit=200)
        if str((entry.get("detail") or {}).get("id") or "") == model_id
    ]
    return _result({"history": entries})


@manager.route("/hindsight/banks/<bank_id>/pages", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_pages(bank_id):
    return _result({"pages": _engine().pages(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/pages/tree", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_pages_tree(bank_id):
    pages = _engine().pages(_tenant(), _bank(bank_id))
    children: dict[str, list[dict]] = {}
    roots = []
    for page in pages:
        parent = str(page.get("parent_id") or "")
        if parent:
            children.setdefault(parent, []).append(page)
        else:
            roots.append(page)
    return _result({"pages": roots, "children": children})


@manager.route("/hindsight/banks/<bank_id>/pages", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_create_page(bank_id):
    body = await _body()
    title = str(body.get("title") or "").strip()
    content = str(body.get("content") or "").strip()
    if not title:
        return get_json_result(code=RetCode.BAD_REQUEST, message="title is required")
    page = _engine().create_page(
        _tenant(), _bank(bank_id), title=title, content=content,
        parent_id=str(body.get("parent_id") or ""),
        tags=body.get("tags") or (),
    )
    return _result(page)


@manager.route("/hindsight/banks/<bank_id>/pages/search", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_search_pages(bank_id):
    body = await _body()
    query = str(body.get("query") or "").strip()
    if not query:
        return _result({"pages": []})
    pages = _engine().search_pages(
        _tenant(), _bank(bank_id), query, limit=int(body.get("limit") or 10)
    )
    return _result({"pages": pages})


@manager.route("/hindsight/banks/<bank_id>/pages/export", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_export_pages(bank_id):
    return _result({"markdown": _engine().export_pages(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/pages/<page_id>", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_page(bank_id, page_id):
    pages = [page for page in _engine().pages(_tenant(), _bank(bank_id)) if page["id"] == page_id]
    if not pages:
        return get_json_result(code=RetCode.NOT_FOUND, message="page not found")
    return _result(pages[0])


@manager.route("/hindsight/banks/<bank_id>/pages/<page_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_page(bank_id, page_id):
    _engine().delete_page(_tenant(), _bank(bank_id), page_id)
    return _result({"deleted": True})


# -- directives -----------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/directives", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_directives(bank_id):
    return _result({"directives": _engine().directives(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/directives", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_create_directive(bank_id):
    body = await _body()
    content = str(body.get("content") or body.get("text") or "").strip()
    if not content:
        return get_json_result(code=RetCode.BAD_REQUEST, message="content is required")
    directive = _engine().add_directive(
        _tenant(), _bank(bank_id), content,
        priority=int(body.get("priority") or 1),
        tags=body.get("tags") or (),
    )
    return _result(directive)


@manager.route("/hindsight/banks/<bank_id>/directives/<directive_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_directive(bank_id, directive_id):
    _engine().delete_directive(_tenant(), _bank(bank_id), directive_id)
    return _result({"deleted": True})


# -- documents / entities -------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/documents", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_documents(bank_id):
    limit = _int_param("limit", 20, high=500)
    return _result({"documents": _engine().documents(_tenant(), _bank(bank_id), limit=limit)})


@manager.route("/hindsight/banks/<bank_id>/documents/<document_id>", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_document(bank_id, document_id):
    document = _engine().get_document(_tenant(), _bank(bank_id), document_id)
    if document is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="document not found")
    return _result(document)


@manager.route("/hindsight/banks/<bank_id>/documents/<document_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_document(bank_id, document_id):
    removed = _engine().delete_document(_tenant(), _bank(bank_id), document_id)
    return _result({"deleted": removed})


@manager.route("/hindsight/banks/<bank_id>/documents/<document_id>/chunks", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_document_chunks(bank_id, document_id):
    tenant, bank = _tenant(), _bank(bank_id)
    limit = _int_param("limit", 50, high=500)
    rows = _engine().store.list_chunks(tenant, bank, document_id)
    if rows:
        return _result({"chunks": rows[:limit], "total": len(rows), "source": "chunks"})
    # A document retained before chunk rows existed still answers with the facts
    # it produced, so the console is not empty for old data.
    units = [
        unit.to_dict()
        for unit in _engine().store.units(tenant, bank, limit=1000)
        if unit.document_id == document_id
    ]
    return _result({"chunks": units[:limit], "total": len(units), "source": "units"})


@manager.route("/hindsight/banks/<bank_id>/entities", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_entities(bank_id):
    return _result({"entities": _engine().store.entities(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/graph", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_graph(bank_id):
    tenant, bank = _tenant(), _bank(bank_id)
    store = _engine().store
    nodes = [
        {"id": entity["name"], "name": entity["name"], "mentions": entity["mentions"], "type": "entity"}
        for entity in store.entities(tenant, bank)
    ]
    edges = [
        {"source": link["from_unit"], "target": link["to_unit"],
         "relation": link["relation"], "weight": link["weight"]}
        for link in store.links(tenant, bank)
    ]
    return _result({"nodes": nodes, "edges": edges})


# -- operations / audit ---------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/operations", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_operations(bank_id):
    return _result({"operations": _engine().operations(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/operations/<operation_id>/cancel", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_cancel_operation(bank_id, operation_id):
    _engine().store.finish_operation(operation_id, status="cancelled", detail={"cancelled": True})
    return _result({"status": "cancelled"})


@manager.route("/hindsight/banks/<bank_id>/operations/<operation_id>/retry", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_retry_operation(bank_id, operation_id):
    # The retain payload is stored with the operation precisely so a failure can
    # be replayed here instead of asking the caller to send the text again.
    tenant, bank = _tenant(), _bank(bank_id)
    operation = _engine().store.get_operation(operation_id)
    if operation is None or operation["tenant_id"] != tenant or operation["bank_id"] != bank:
        return get_json_result(code=RetCode.NOT_FOUND, message="operation not found")
    if operation["kind"] != "retain":
        return get_json_result(code=RetCode.BAD_REQUEST, message="only retain operations can be replayed")
    if operation["status"] in ("queued", "running"):
        return _result({"status": operation["status"], "queued": False})
    if not str(operation["payload"].get("content") or "").strip():
        return get_json_result(code=RetCode.BAD_REQUEST, message="operation has no payload to replay")
    _engine().store.finish_operation(operation_id, status="queued", detail={}, error="")
    await _engine().retain_worker.submit_async(operation_id)
    return _result({"status": "queued", "queued": True})


@manager.route("/hindsight/banks/<bank_id>/audit-logs", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_audit_logs(bank_id):
    limit = _int_param("limit", 50, high=500)
    return _result({"audit_logs": _engine().audit_logs(_tenant(), _bank(bank_id), limit=limit)})


@manager.route("/hindsight/banks/<bank_id>/llm-requests", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_llm_requests(bank_id):
    # Extraction, reflection and consolidation all run through the tenant's own
    # LLM bundle, which keeps its own request ledger; this bank tracks none.
    return _result({"requests": []})


@manager.route("/hindsight/banks/<bank_id>/export", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_export_bank(bank_id):
    return _result(_engine().export_bank(_tenant(), _bank(bank_id)))


@manager.route("/hindsight/banks/<bank_id>/import", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_import_bank(bank_id):
    return _result(_engine().import_bank(_tenant(), _bank(bank_id), await _body()))


# -- worker / maintenance -------------------------------------------------


@manager.route("/hindsight/worker", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_worker():
    return _result({
        "worker": _engine().worker_status(_tenant(), _bank("")),
        "scheduler": _engine().scheduler_status(),
    })


@manager.route("/hindsight/worker/start", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_worker_start():
    await _engine().retain_worker.start()
    await _engine().start_scheduler()
    return _result({
        "worker": _engine().worker_status(_tenant(), _bank("")),
        "scheduler": _engine().scheduler_status(),
    })


@manager.route("/hindsight/maintenance", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_maintenance():
    # Manual sweep: refresh stale mental models and consolidate pending facts in
    # every bank the scheduler would touch, without waiting for its tick.
    return _result(await _engine().run_maintenance())


@manager.route("/hindsight/banks/<bank_id>/prune", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_prune(bank_id):
    body = await _body()
    try:
        days = max(1, min(3650, int(body.get("days") or 90)))
    except (TypeError, ValueError):
        days = 90
    dry_run = bool(body.get("dry_run"))
    return _result(_engine().prune(_tenant(), _bank(bank_id), days=days, dry_run=dry_run))


# -- vector index ---------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/vector-index", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_vector_index(bank_id):
    # Which store the semantic arm searches, and whether it is in step with the
    # SQLite copy: the console has to be able to see a lagging index.
    return _result(_engine().vector_index_status(_tenant(), _bank(bank_id)))


@manager.route("/hindsight/banks/<bank_id>/vector-index/rebuild", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_rebuild_vector_index(bank_id):
    # Re-index from the vectors SQLite already holds; nothing is re-embedded.
    return _result(_engine().rebuild_vector_index(_tenant(), _bank(bank_id)))


# -- aliases --------------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/aliases", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_aliases(bank_id):
    return _result({"aliases": _engine().store.aliases(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/aliases", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_create_alias(bank_id):
    body = await _body()
    alias = str(body.get("alias") or "").strip()
    canonical = str(body.get("canonical") or "").strip()
    if not alias or not canonical:
        return get_json_result(code=RetCode.BAD_REQUEST, message="alias and canonical are required")
    if alias.lower() == canonical.lower():
        return get_json_result(code=RetCode.BAD_REQUEST, message="alias and canonical are identical")
    _engine().store.add_alias(_tenant(), _bank(bank_id), alias, canonical)
    return _result({"alias": alias, "canonical": canonical})


@manager.route("/hindsight/banks/<bank_id>/aliases/<alias>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_alias(bank_id, alias):
    _engine().store.delete_alias(_tenant(), _bank(bank_id), alias)
    return _result({"deleted": True})


# -- webhooks -------------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/webhooks", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_webhooks(bank_id):
    return _result({"webhooks": _engine().store.webhooks(_tenant(), _bank(bank_id))})


@manager.route("/hindsight/banks/<bank_id>/webhooks", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_create_webhook(bank_id):
    body = await _body()
    url = str(body.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return get_json_result(code=RetCode.BAD_REQUEST, message="url must be http(s)")
    events = [str(event) for event in body.get("events") or [] if str(event) in webhook_events.EVENTS]
    unknown = [str(event) for event in body.get("events") or [] if str(event) not in webhook_events.EVENTS]
    if unknown:
        return get_json_result(
            code=RetCode.BAD_REQUEST,
            message=f"unknown event(s): {', '.join(unknown)}",
        )
    secret = str(body.get("secret") or secrets.token_hex(16))
    hook = _engine().store.add_webhook(_tenant(), _bank(bank_id), url, events=events, secret=secret)
    return _result(hook)


@manager.route("/hindsight/banks/<bank_id>/webhooks/<webhook_id>", methods=["DELETE"])  # noqa: F821
@login_required
async def hindsight_delete_webhook(bank_id, webhook_id):
    tenant, bank = _tenant(), _bank(bank_id)
    hook = _engine().store.get_webhook(tenant, bank, webhook_id)
    if hook is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="webhook not found")
    _engine().store.delete_webhook(tenant, bank, webhook_id)
    return _result({"deleted": True})


@manager.route("/hindsight/banks/<bank_id>/webhooks/<webhook_id>", methods=["PATCH"])  # noqa: F821
@login_required
async def hindsight_toggle_webhook(bank_id, webhook_id):
    body = await _body()
    tenant, bank = _tenant(), _bank(bank_id)
    hook = _engine().store.get_webhook(tenant, bank, webhook_id)
    if hook is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="webhook not found")
    active = bool(body.get("active", True))
    _engine().store.set_webhook_active(tenant, bank, webhook_id, active)
    return _result({"id": webhook_id, "active": active})


@manager.route("/hindsight/banks/<bank_id>/webhooks/<webhook_id>/deliveries", methods=["GET"])  # noqa: F821
@login_required
async def hindsight_webhook_deliveries(bank_id, webhook_id):
    limit = _int_param("limit", 20, high=200)
    rows = _engine().store.deliveries(_tenant(), _bank(bank_id), webhook_id=webhook_id, limit=limit)
    return _result({"deliveries": rows})


@manager.route("/hindsight/banks/<bank_id>/webhooks/<webhook_id>/test", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_test_webhook(bank_id, webhook_id):
    tenant, bank = _tenant(), _bank(bank_id)
    hook = _engine().store.get_webhook(tenant, bank, webhook_id)
    if hook is None:
        return get_json_result(code=RetCode.NOT_FOUND, message="webhook not found")
    result = await webhook_events.send_test(hook)
    return _result(result)


# -- file ingest ----------------------------------------------------------


@manager.route("/hindsight/banks/<bank_id>/ingest", methods=["POST"])  # noqa: F821
@login_required
async def hindsight_ingest(bank_id):
    files = await request.files
    if "file" not in files:
        return get_json_result(code=RetCode.BAD_REQUEST, message="missing 'file' in multipart form-data")
    uploaded = files["file"]
    filename = uploaded.filename or "upload"
    # A dry run only reports what the file would become, so it costs no model call.
    form = await request.form
    dry_run = str(form.get("dry_run", "")).lower() in ("1", "true", "yes")
    document_id = str(form.get("document_id") or "").strip() or filename
    try:
        size = max(500, min(20000, int(form.get("chunk_size") or ingest_files.CHUNK_CHARS)))
    except (TypeError, ValueError):
        size = ingest_files.CHUNK_CHARS
    tags = [tag.strip() for tag in str(form.get("tags") or "").split(",") if tag.strip()]

    tenant, bank = _tenant(), _bank(bank_id)
    # UploadedFile.read() is synchronous in Quart; awaiting it raises
    # TypeError("object bytes can't be used in 'await' expression").
    raw = uploaded.read()
    data = await raw if inspect.isawaitable(raw) else raw
    try:
        text = await ingest_files.extract_text(data, filename, providers=None if dry_run else _backend().providers(tenant))
    except ingest_files.IngestError as exc:
        return get_json_result(code=RetCode.BAD_REQUEST, message=str(exc))
    except Exception as exc:  # noqa: BLE001 - a parser or vision failure is a user-facing error
        logging.exception("hindsight ingest failed for %s", filename)
        return _failure("failed to read the uploaded file", detail=str(exc))

    chunks = ingest_files.chunk_text(text, max_chars=size)
    if not chunks:
        return get_json_result(code=RetCode.BAD_REQUEST, message="no text could be extracted")
    if dry_run:
        return _result({
            "filename": filename,
            "chars": len(text),
            "chunks": len(chunks),
            "preview": chunks[0][:1000],
            "dry_run": True,
        })

    # The whole body is retained once and chunked inside the engine, the way
    # Hindsight does it: one document, N stored chunks, every extracted fact
    # pointing back at the chunk it came from. Ingesting each chunk as its own
    # document (what this used to do) loses that link and makes the document
    # list show one row per chunk.
    engine = _engine()
    metadata = {"source": "upload", "filename": filename}
    if _backend().retain_async:
        queued = await engine.enqueue_retain(
            tenant, bank, text,
            document_id=document_id, tags=tags, metadata=metadata,
            providers_factory=_backend().providers, chunk_chars=size,
        )
        return _result({
            "filename": filename,
            "chars": len(text),
            "chunks": len(chunks),
            "queued": [queued.get("operation_id")],
            "dry_run": False,
        })
    stored = await engine.retain(
        tenant, bank, text,
        document_id=document_id, tags=tags, metadata=metadata,
        providers=_backend().providers(tenant), chunk_chars=size,
    )
    return _result({
        "filename": filename,
        "chars": len(text),
        "chunks": stored.get("chunks", len(chunks)),
        "stored": stored.get("stored", 0),
        "queued": [],
        "dry_run": False,
    })
