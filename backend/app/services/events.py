"""In-process event bus for SSE streams (B9).

发布方可能在任何线程（APScheduler worker），订阅方是 asyncio 队列：
``publish`` 通过保存的事件循环 ``call_soon_threadsafe`` 投递，避免跨线程写队列。
"""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class EventMessage:
    """One server-sent event."""

    event: str
    data: dict[str, Any] = field(default_factory=dict)


class EventBus:
    """Fan-out bus with per-subscriber queues (no history replay)."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[EventMessage]] = set()
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Remember the event loop used to deliver cross-thread publishes."""
        self._loop = loop or asyncio.get_running_loop()

    def subscribe(self) -> asyncio.Queue[EventMessage]:
        """Register a queue; caller must ``unsubscribe`` in finally."""
        queue: asyncio.Queue[EventMessage] = asyncio.Queue(maxsize=256)
        if self._loop is None:
            try:
                self.bind_loop()
            except RuntimeError:  # pragma: no cover - 无运行循环时退化为直接投递
                self._loop = None
        with self._lock:
            self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[EventMessage]) -> None:
        """Drop a subscriber queue."""
        with self._lock:
            self._subscribers.discard(queue)

    def publish(self, event: str, data: dict[str, Any]) -> None:
        """Publish to every subscriber, dropping when their queue is full."""
        message = EventMessage(event=event, data=data)
        with self._lock:
            queues = list(self._subscribers)
        for queue in queues:
            loop = self._loop
            if loop is not None and not loop.is_closed():
                loop.call_soon_threadsafe(_put_latest, queue, message)
            else:  # pragma: no cover - 极少发生（未绑定循环）
                _put_latest(queue, message)


def _put_latest(queue: asyncio.Queue[EventMessage], message: EventMessage) -> None:
    if queue.full():
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:  # pragma: no cover - 竞争保护
            return
    queue.put_nowait(message)
