"""Self-hosted Mem0 REST sidecar for RAGFlow's chat memory.

RAGFlow talks to this service over two endpoints:

    POST /memories          -> store one chat turn (Mem0 extracts facts)
    POST /memories/search   -> recall memories relevant to a question

The sidecar owns the Mem0 OSS pipeline (fact extraction + embeddings + vector
search) so the RAGFlow API server does not have to depend on mem0ai or on a
particular vector store. Qdrant is the default vector store; any provider Mem0
supports can be swapped in through the env vars below.

Environment:
    OPENAI_API_KEY         API key for the extraction LLM and the embedder
    OPENAI_BASE_URL        OpenAI-compatible base URL (default: OpenAI)
    MEM0_LLM_MODEL         LLM used for fact extraction (default gpt-4o-mini)
    MEM0_EMBED_MODEL       embedding model (default text-embedding-3-small)
    MEM0_EMBED_DIMS        embedding dimensions (default 1536)
    QDRANT_HOST / QDRANT_PORT / MEM0_COLLECTION
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="ragflow-mem0", version="1.0")

# Chat memory is a picture of the person, not a work log: the extractor only
# keeps durable preferences/facts about the user and notable recent events.
# Work details, code, credentials and document content belong to work mode's
# project bank (the native Hindsight engine) and must not end up in this store.
FACT_EXTRACTION_PROMPT = """You are a personal memory extractor for a chat assistant.

From the conversation, extract ONLY:
1. stable facts about the person (name, language, location, role, preferences,
   habits, constraints, relationships, ongoing personal projects);
2. recent events worth remembering next time (plans, decisions about their own
   life, things they said they would do);
3. explicit instructions about how the assistant should talk to them.

Never extract: source code, file paths, credentials, keys, business documents,
internal work discussions, or anything the person did not say about themselves.
Skip small talk, greetings and one-off questions with no lasting value.
If nothing qualifies, return an empty list.

Return JSON exactly as: {"facts": ["...", "..."]}
Conversation:
"""


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _build_config() -> dict[str, Any]:
    api_key = _env("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required by the mem0 sidecar")
    base_url = _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
    llm_config: dict[str, Any] = {"model": _env("MEM0_LLM_MODEL", "gpt-4o-mini"), "api_key": api_key}
    embed_config: dict[str, Any] = {
        "model": _env("MEM0_EMBED_MODEL", "text-embedding-3-small"),
        "api_key": api_key,
    }
    if base_url:
        llm_config["openai_base_url"] = base_url
        embed_config["openai_base_url"] = base_url
    dims = _env("MEM0_EMBED_DIMS")
    if dims:
        embed_config["embedding_dims"] = int(dims)
    return {
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "host": _env("QDRANT_HOST", "qdrant"),
                "port": int(_env("QDRANT_PORT", "6333")),
                "collection_name": _env("MEM0_COLLECTION", "ragflow_chat"),
                "embedding_model_dims": int(dims) if dims else 1536,
            },
        },
        "llm": {"provider": "openai", "config": llm_config},
        "embedder": {"provider": "openai", "config": embed_config},
        "custom_fact_extraction_prompt": FACT_EXTRACTION_PROMPT,
    }


_MEMORY = None


def memory():
    global _MEMORY
    if _MEMORY is None:
        from mem0 import Memory

        _MEMORY = Memory.from_config(_build_config())
    return _MEMORY


class Message(BaseModel):
    role: str
    content: str


class AddRequest(BaseModel):
    messages: list[Message]
    user_id: str = Field(min_length=1)
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict[str, Any] | None = None
    infer: bool = True


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    limit: int = 5
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict[str, Any] | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        memory()
    except Exception as exc:  # noqa: BLE001 - surface the reason to the caller
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/memories")
def add_memories(req: AddRequest) -> dict[str, Any]:
    try:
        result = memory().add(
            [message.model_dump() for message in req.messages],
            user_id=req.user_id,
            agent_id=req.agent_id,
            run_id=req.run_id,
            metadata=req.metadata,
            infer=req.infer,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"mem0 add failed: {exc}") from exc
    return result if isinstance(result, dict) else {"results": result}


@app.post("/memories/search")
def search_memories(req: SearchRequest) -> dict[str, Any]:
    try:
        engine = memory()
        try:
            result = engine.search(req.query, user_id=req.user_id, limit=req.limit)
        except TypeError:
            # mem0 >= 1.0 moved the scope into filters/top_k.
            result = engine.search(req.query, filters={"user_id": req.user_id}, top_k=req.limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"mem0 search failed: {exc}") from exc
    return result if isinstance(result, dict) else {"results": result}
