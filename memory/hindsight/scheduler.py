"""Periodic upkeep: refresh stale mental models, consolidate pending facts.

Neither job belongs in a request path. A mental model summarises a whole bank,
and consolidation rewrites observations from many facts; doing either because a
user happened to open a page would make the console feel random. A single
background loop gives them a clock instead: every tick it asks the store which
banks have overdue work and does only that.

The loop is idempotent and safe to start late: overdue work is computed from
timestamps, so a process that was down catches up on its next tick.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from memory.hindsight.llm import NullProviders

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
REFRESH_HOURS = 24
CONSOLIDATE_MINUTES = 60


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemoryScheduler:
    """One background loop per engine; starts on first use, stops on shutdown."""

    def __init__(
        self,
        engine,
        *,
        refresh_hours: int = REFRESH_HOURS,
        consolidate_minutes: int = CONSOLIDATE_MINUTES,
        tick_seconds: int = TICK_SECONDS,
    ):
        self.engine = engine
        self.refresh_hours = max(1, refresh_hours)
        self.consolidate_minutes = max(1, consolidate_minutes)
        self.tick_seconds = max(5, tick_seconds)
        self._task: asyncio.Task | None = None
        self._last_run = ""
        self._last_error = ""
        self._refreshed = 0
        self._consolidated = 0

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_due()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - upkeep must never kill the process
                self._last_error = f"{type(exc).__name__}: {exc}"
                logger.warning("hindsight scheduler: tick failed (%s)", exc)
            await asyncio.sleep(self.tick_seconds)

    async def run_due(self, *, force: bool = False) -> dict[str, Any]:
        """Do whatever is overdue; force ignores the intervals but not failures."""
        factory = getattr(self.engine, "_providers_factory", None)
        store = self.engine.store
        refreshed = 0
        consolidated = 0
        skipped = 0
        for bank in store.all_banks():
            tenant_id, bank_id = bank["tenant_id"], bank["bank_id"]
            providers = factory(tenant_id) if factory else NullProviders()
            if isinstance(providers, NullProviders):
                skipped += 1
                continue
            for model in store.stale_mental_models(
                tenant_id, bank_id, hours=1 if force else self.refresh_hours
            ):
                try:
                    await self.engine.refresh_mental_model(
                        tenant_id, bank_id, model["id"], providers=providers
                    )
                    refreshed += 1
                except Exception as exc:  # noqa: BLE001 - one model must not stop the rest
                    logger.warning("hindsight scheduler: refresh %s failed (%s)", model["id"], exc)
            pending = [
                unit for unit in store.units(tenant_id, bank_id, kind="fact", limit=400)
                if not unit.consolidated_at and not unit.superseded_by
            ]
            if not pending:
                continue
            if not force and not self._due(store, tenant_id, bank_id):
                continue
            try:
                await self.engine.consolidate(tenant_id, bank_id, providers=providers)
                consolidated += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("hindsight scheduler: consolidate %s failed (%s)", bank_id, exc)
        self._refreshed += refreshed
        self._consolidated += consolidated
        self._last_run = _now().isoformat(timespec="seconds")
        return {"refreshed": refreshed, "consolidated": consolidated, "skipped": skipped}

    def _due(self, store, tenant_id: str, bank_id: str) -> bool:
        rows = store.audit_logs(tenant_id, bank_id, limit=40)
        for row in rows:
            if row["action"] != "consolidate":
                continue
            at = _parse(row["created_at"])
            if at is None:
                continue
            return (_now() - at).total_seconds() >= self.consolidate_minutes * 60
        return True

    def status(self) -> dict[str, Any]:
        return {
            "started": self._task is not None,
            "tick_seconds": self.tick_seconds,
            "refresh_hours": self.refresh_hours,
            "consolidate_minutes": self.consolidate_minutes,
            "last_run": self._last_run,
            "last_error": self._last_error,
            "refreshed": self._refreshed,
            "consolidated": self._consolidated,
        }


def _parse(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed
