"""Performance baseline for B13 (runs against a throwaway data dir, no network).

用法（在 ``backend/`` 下）::

    .venv/Scripts/python.exe ../scripts/bench.py
"""

from __future__ import annotations

import json
import shutil
import statistics
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.embedding import DeterministicEmbedder, EmbeddingService
from app.services.indexing import IndexService
from app.services.vector_store import MemoryVectorStore

TOKEN = "bench-token-0123456789abcdef"
ITEM_COUNT = 200
SEARCH_ROUNDS = 20


def main() -> None:
    data_dir = Path(tempfile.mkdtemp(prefix="pkb-bench-"))
    settings = Settings(
        token=TOKEN,
        data_dir=data_dir,
        privacy_allow_external_calls=False,
        reminder_scheduler_enabled=False,
        embedding_dimension=64,
        _env_file=None,
    )
    started = time.perf_counter()
    app = create_app(settings)
    with TestClient(app) as client:
        startup_ms = (time.perf_counter() - started) * 1000
        auth = {"Authorization": f"Bearer {TOKEN}"}

        state = app.state
        store = MemoryVectorStore()
        embedder = EmbeddingService(settings, embedder=DeterministicEmbedder(dimension=64))
        state.vector_store = store
        state.index_service = IndexService(settings, state.session_factory, store, embedder, synchronous=True)
        from app.services.search import SearchService

        state.search_service = SearchService(settings, state.session_factory, store, embedder)

        durations: list[float] = []
        for index in range(ITEM_COUNT):
            begin = time.perf_counter()
            response = client.post(
                "/api/v1/items",
                json={
                    "type": "note",
                    "title": f"基准条目 {index} 向量检索",
                    "content": f"第 {index} 条内容，讨论向量检索与倒数排名融合。" * 5,
                },
                headers=auth,
            )
            durations.append((time.perf_counter() - begin) * 1000)
            assert response.status_code == 201, response.text

        begin = time.perf_counter()
        listing = client.get("/api/v1/items", params={"page_size": 50}, headers=auth)
        list_ms = (time.perf_counter() - begin) * 1000
        assert listing.status_code == 200

        begin = time.perf_counter()
        reindex = client.post("/api/v1/index/reindex", json={"mode": "full"}, headers=auth)
        index_ms = (time.perf_counter() - begin) * 1000
        assert reindex.status_code == 202, reindex.text

        search_ms: list[float] = []
        for _ in range(SEARCH_ROUNDS):
            begin = time.perf_counter()
            response = client.get(
                "/api/v1/search", params={"q": "向量检索", "mode": "hybrid"}, headers=auth
            )
            search_ms.append((time.perf_counter() - begin) * 1000)
            assert response.status_code == 200, response.text

    report = {
        "items": ITEM_COUNT,
        "startup_ms": round(startup_ms, 1),
        "item_create_ms_p50": round(statistics.median(durations), 1),
        "item_create_ms_p95": round(statistics.quantiles(durations, n=20)[18], 1),
        "item_list_50_ms": round(list_ms, 1),
        "index_full_ms": round(index_ms, 1),
        "search_hybrid_ms_p50": round(statistics.median(search_ms), 1),
        "search_hybrid_ms_p95": round(statistics.quantiles(search_ms, n=20)[18], 1),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
