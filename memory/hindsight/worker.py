"""A small, persistent-async worker queue for memory writes.

Retaining a conversation turn costs an extraction call, then an embedding call,
then consolidation. Doing that inline in the chat request would make the user
wait for a model that produces nothing they can see, so the request only records
the operation and the queue does the work.

The queue is in-process (asyncio) but not in-memory-only: every job is an
operations row with its payload, attempts and last error, so a restart, a
cancel or a retry can all be honoured from the database. That is the part a bare
asyncio.Queue cannot do.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from memory.hindsight.store import MemoryStore

logger = logging.getLogger(__name__)

CONCURRENCY = 2
RETRIES = 2
POLL_SECONDS = 0.2


class RetainWorker:
    """Runs queued operations with bounded concurrency and DB-backed state."""

    def __init__(
        self,
        store: MemoryStore,
        runner: Callable[[dict[str, Any]], Awaitable[None]],
        *,
        concurrency: int = CONCURRENCY,
        retries: int = RETRIES,
    ):
        self.store = store
        self.runner = runner
        self.concurrency = max(1, concurrency)
        self.retries = max(0, retries)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._loop: asyncio.AbstractEventLoop | None = None
        self._running = 0
        self._done = 0
        self._failed = 0

    # -- lifecycle -----------------------------------------------------

    def start(self) -> None:
        if self._tasks:
            return
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        for index in range(self.concurrency):
            self._tasks.append(asyncio.create_task(self._consume(index)))
        for operation_id in self._recover():
            self.submit(operation_id)

    def _recover(self) -> list[str]:
        """Re-queue work a previous process left behind.

        Without this a restart mid-job strands the operations row in running
        forever and the turn is silently never remembered.
        """
        try:
            return self.store.recover_operations()
        except Exception as exc:  # noqa: BLE001 - recovery must not block start
            logger.debug("hindsight worker: recovery skipped (%s)", exc)
            return []

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        self._tasks.clear()
        self._queue = asyncio.Queue()

    def submit(self, operation_id: str) -> None:
        """Enqueue from sync code; no-op when no loop owns the worker."""
        if not self._tasks or self._loop is None:
            return
        try:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, operation_id)
        except RuntimeError:  # loop closed while shutting down
            logger.debug("hindsight worker: submit after loop close ignored")

    async def submit_async(self, operation_id: str) -> None:
        if not self._tasks:
            self.start()
        await self._queue.put(operation_id)

    # -- consumption ---------------------------------------------------

    async def _consume(self, index: int) -> None:
        while True:
            operation_id = await self._queue.get()
            self._running += 1
            try:
                await self._run(operation_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a job must not kill the loop
                logger.warning("hindsight worker: %s crashed (%s)", operation_id, exc)
            finally:
                self._running -= 1
                self._queue.task_done()

    async def _run(self, operation_id: str) -> None:
        operation = self.store.get_operation(operation_id)
        if not operation or operation["status"] in ("cancelled", "done", "failed", "skipped"):
            return
        attempts = operation["attempts"] + 1
        self.store.finish_operation(operation_id, status="running", attempts=attempts)
        try:
            await self.runner(operation)
        except Exception as exc:  # noqa: BLE001
            message = f"{type(exc).__name__}: {exc}"
            if attempts <= self.retries:
                self.store.finish_operation(operation_id, status="queued",
                                            error=message, attempts=attempts)
                await asyncio.sleep(min(5.0, 0.5 * attempts))
                self.submit(operation_id)
                return
            self.store.finish_operation(operation_id, status="failed",
                                        error=message, attempts=attempts)
            self._failed += 1
            logger.warning("hindsight worker: %s failed (%s)", operation_id, message)
            return
        self._done += 1

    # -- introspection -------------------------------------------------

    def status(self, tenant_id: str = "", bank_id: str = "") -> dict[str, Any]:
        counts: dict[str, int] = {}
        try:
            counts = self.store.operation_counts(tenant_id, bank_id)
        except Exception as exc:  # noqa: BLE001 - status must still render
            logger.debug("hindsight worker: counts unavailable (%s)", exc)
        return {
            "started": bool(self._tasks),
            "concurrency": self.concurrency,
            "queued": self._queue.qsize(),
            "running": self._running,
            "done": self._done,
            "failed": self._failed,
            "operations": counts,
        }
