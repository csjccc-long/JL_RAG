"""Outbound webhooks for memory events.

A write or a consolidation is asynchronous by nature: the caller got its answer
long before the memory became queryable. Webhooks are how an external app finds
out that it happened, without polling operations.

Delivery never blocks the memory path. emit() only schedules; each delivery runs
in its own task, retries with backoff, and records every attempt so a failure is
visible in the console instead of disappearing into a log line.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

from memory.hindsight.store import MemoryStore, utcnow

logger = logging.getLogger(__name__)

EVENTS = (
    "retain",
    "consolidate",
    "mental_model.refresh",
    "memory.delete",
    "document.delete",
)
RETRIES = 3
TIMEOUT = 8.0


def signature(secret: str, body: bytes) -> str:
    """Hex HMAC-SHA256, the header a receiver should verify before trusting."""
    return hmac.new((secret or "").encode("utf-8"), body, hashlib.sha256).hexdigest()


async def emit(
    store: MemoryStore,
    tenant_id: str,
    bank_id: str,
    event: str,
    payload: dict[str, Any],
) -> int:
    """Schedule deliveries; returns how many hooks matched, never raises."""
    try:
        hooks = [hook for hook in store.webhooks(tenant_id, bank_id)
                 if hook["active"] and (not hook["events"] or event in hook["events"])]
    except Exception as exc:  # noqa: BLE001 - a broken table must not fail a write
        logger.warning("hindsight webhook: lookup failed (%s)", exc)
        return 0
    for hook in hooks:
        try:
            delivery_id = store.add_delivery(hook["id"], tenant_id, bank_id, event, payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight webhook: cannot record delivery (%s)", exc)
            continue
        asyncio.create_task(_deliver(store, hook, delivery_id, event, payload))
    return len(hooks)


async def _deliver(
    store: MemoryStore,
    hook: dict[str, Any],
    delivery_id: str,
    event: str,
    payload: dict[str, Any],
) -> None:
    body_obj = {
        "id": delivery_id,
        "event": event,
        "created_at": utcnow(),
        "data": payload,
    }
    body = json.dumps(body_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Hindsight-Event": event,
        "X-Hindsight-Delivery": delivery_id,
        "X-Hindsight-Signature": "sha256=" + signature(hook["secret"], body),
    }
    error = ""
    response_code = 0
    async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False) as client:
        for attempt in range(1, RETRIES + 1):
            try:
                response = await client.post(hook["url"], content=body, headers=headers)
                response_code = response.status_code
                if 200 <= response_code < 300:
                    store.finish_delivery(delivery_id, status="delivered", attempts=attempt,
                                          response_code=response_code)
                    return
                error = f"HTTP {response_code}: {response.text[:200]}"
            except Exception as exc:  # noqa: BLE001 - network errors are retried
                error = f"{type(exc).__name__}: {exc}"
            store.finish_delivery(delivery_id, status="retrying", attempts=attempt,
                                  response_code=response_code, error=error)
            if attempt < RETRIES:
                await asyncio.sleep(0.5 * (2 ** (attempt - 1)))
    store.finish_delivery(delivery_id, status="failed", attempts=RETRIES,
                          response_code=response_code, error=error)
    logger.warning("hindsight webhook: %s failed for %s (%s)", hook["id"], event, error)


async def send_test(hook: dict[str, Any], *, event: str = "retain") -> dict[str, Any]:
    """Synchronous one-shot used by the console's 'test' button."""
    payload = {"probe": True, "at": time.time()}
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Hindsight-Event": event,
        "X-Hindsight-Signature": "sha256=" + signature(hook["secret"], body),
    }
    async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False) as client:
        response = await client.post(hook["url"], content=body, headers=headers)
        return {"status": response.status_code, "body": response.text[:500]}
