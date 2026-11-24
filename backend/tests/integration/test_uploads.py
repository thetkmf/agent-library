"""Chunked upload sessions, chunk PUT and complete (§6.2)."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from app.core.config import Settings
from app.db.base import utcnow
from app.main import create_app
from app.services.uploads import SESSION_FILE, cleanup_expired
from fastapi.testclient import TestClient

CHUNK = 5 * 1024 * 1024
PAYLOAD = b"x" * CHUNK + b"tail-bytes"
TOKEN = "test-token-0123456789abcdef"


@pytest.fixture()
def upload_settings(tmp_path: Path) -> Settings:
    return Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        chunk_size_bytes=CHUNK,
        _env_file=None,
    )


@pytest.fixture()
def client(upload_settings: Settings):
    with TestClient(create_app(upload_settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def init_upload(
    client: TestClient,
    auth: dict[str, str],
    *,
    payload: bytes = PAYLOAD,
    name: str = "大文件.zip",
    mime: str = "application/zip",
    declared_sha: str | None = None,
    size: int | None = None,
    tags: list[str] | None = None,
) -> tuple[int, Any]:
    response = client.post(
        "/api/v1/uploads",
        json={
            "original_name": name,
            "size_bytes": len(payload) if size is None else size,
            "mime_type": mime,
            "sha256": declared_sha or sha(payload),
            "title": "分片上传",
            "tags": tags or ["上传"],
        },
        headers=auth,
    )
    return response.status_code, response.json()


def split(payload: bytes, chunk: int) -> list[bytes]:
    return [payload[index : index + chunk] for index in range(0, len(payload), chunk)]


def test_init_returns_chunk_plan(client: TestClient, auth: dict[str, str]) -> None:
    status, body = init_upload(client, auth)
    assert status == 201, body
    data = body["data"]
    assert data["chunk_size"] == CHUNK
    assert data["chunk_count"] == 2
    assert data["upload_id"]


def test_init_validates_input(client: TestClient, auth: dict[str, str]) -> None:
    zero = init_upload(client, auth, size=0)
    assert zero[0] == 400 and zero[1]["code"] == 40002

    bad_sha = init_upload(client, auth, declared_sha="not-a-digest")
    assert bad_sha[0] == 400 and bad_sha[1]["code"] == 40002

    bad_type = init_upload(client, auth, name="恶意.exe", mime="application/x-msdownload")
    assert bad_type[0] == 415 and bad_type[1]["code"] == 40003


def test_init_rejects_oversize(tmp_path: Path) -> None:
    settings = Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        max_file_bytes=1024,
        _env_file=None,
    )
    with TestClient(create_app(settings)) as client:
        headers = {"Authorization": f"Bearer {TOKEN}"}
        status, body = init_upload(client, headers, payload=b"y" * 2048)
    assert status == 413
    assert body["code"] == 40004


def test_chunks_out_of_order_then_complete(
    client: TestClient, auth: dict[str, str], upload_settings: Settings
) -> None:
    _, body = init_upload(client, auth)
    upload_id = body["data"]["upload_id"]
    parts = split(PAYLOAD, CHUNK)
    assert len(parts) == 2

    second = client.put(
        f"/api/v1/uploads/{upload_id}/chunks/1",
        content=parts[1],
        headers={**auth, "Content-Type": "application/octet-stream"},
    )
    assert second.status_code == 200
    assert second.json()["data"] == {"index": 1, "sha256": sha(parts[1])}

    first = client.put(
        f"/api/v1/uploads/{upload_id}/chunks/0",
        content=parts[0],
        headers={**auth, "Content-Type": "application/octet-stream"},
    )
    assert first.status_code == 200

    completed = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=auth)
    assert completed.status_code == 200, completed.text
    data = completed.json()["data"]
    assert data["item"]["type"] == "file"
    assert data["item"]["title"] == "分片上传"
    assert data["file_asset"]["size_bytes"] == len(PAYLOAD)
    assert data["file_asset"]["sha256"] == sha(PAYLOAD)
    assert {tag["name"] for tag in data["item"]["tags"]} == {"上传"}

    chunks_dir = upload_settings.data_dir / "uploads" / upload_id / "chunks"
    assert not chunks_dir.exists()
    session_file = upload_settings.data_dir / "uploads" / upload_id / SESSION_FILE
    state = json.loads(session_file.read_text(encoding="utf-8"))
    assert state["completed_item_id"] == data["item"]["id"]


def test_chunk_reupload_is_idempotent(client: TestClient, auth: dict[str, str]) -> None:
    _, body = init_upload(client, auth)
    upload_id = body["data"]["upload_id"]
    parts = split(PAYLOAD, CHUNK)
    url = f"/api/v1/uploads/{upload_id}/chunks/0"
    first = client.put(url, content=parts[0], headers=auth)
    again = client.put(url, content=parts[0], headers=auth)
    assert first.status_code == again.status_code == 200
    assert first.json()["data"] == again.json()["data"]


def test_chunk_validation(client: TestClient, auth: dict[str, str]) -> None:
    _, body = init_upload(client, auth)
    upload_id = body["data"]["upload_id"]

    wrong_size = client.put(f"/api/v1/uploads/{upload_id}/chunks/0", content=b"short", headers=auth)
    assert wrong_size.status_code == 400
    assert wrong_size.json()["code"] == 40005

    out_of_range = client.put(f"/api/v1/uploads/{upload_id}/chunks/9", content=b"x", headers=auth)
    assert out_of_range.status_code == 400
    assert out_of_range.json()["code"] == 40005


def test_complete_requires_all_chunks(client: TestClient, auth: dict[str, str]) -> None:
    _, body = init_upload(client, auth)
    upload_id = body["data"]["upload_id"]
    parts = split(PAYLOAD, CHUNK)
    client.put(f"/api/v1/uploads/{upload_id}/chunks/0", content=parts[0], headers=auth)

    response = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=auth)
    assert response.status_code == 400
    assert response.json()["code"] == 40005
    assert response.json()["details"]["missing_index"] == 1


def test_complete_rejects_sha_mismatch(
    client: TestClient, auth: dict[str, str], upload_settings: Settings
) -> None:
    _, body = init_upload(client, auth, declared_sha=sha(b"different content"))
    upload_id = body["data"]["upload_id"]
    for index, part in enumerate(split(PAYLOAD, CHUNK)):
        client.put(f"/api/v1/uploads/{upload_id}/chunks/{index}", content=part, headers=auth)

    response = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=auth)
    assert response.status_code == 400
    assert response.json()["code"] == 40005

    files_dir = upload_settings.data_dir / "files"
    leftovers = [p for p in files_dir.rglob("*") if p.is_file()] if files_dir.exists() else []
    assert leftovers == []


def test_complete_is_idempotent(client: TestClient, auth: dict[str, str]) -> None:
    _, body = init_upload(client, auth)
    upload_id = body["data"]["upload_id"]
    for index, part in enumerate(split(PAYLOAD, CHUNK)):
        client.put(f"/api/v1/uploads/{upload_id}/chunks/{index}", content=part, headers=auth)

    first = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=auth)
    second = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=auth)
    assert first.status_code == second.status_code == 200
    assert first.json()["data"]["item"]["id"] == second.json()["data"]["item"]["id"]
    assert first.json()["data"]["file_asset"]["id"] == second.json()["data"]["file_asset"]["id"]

    listed = client.get("/api/v1/items", params={"type": "file"}, headers=auth).json()["data"]
    assert listed["total"] == 1


def test_expired_session_returns_not_found(
    client: TestClient, auth: dict[str, str], upload_settings: Settings
) -> None:
    _, body = init_upload(client, auth)
    upload_id = body["data"]["upload_id"]
    session_file = upload_settings.data_dir / "uploads" / upload_id / SESSION_FILE
    state = json.loads(session_file.read_text(encoding="utf-8"))
    state["created_at"] = (utcnow() - timedelta(hours=25)).isoformat()
    session_file.write_text(json.dumps(state), encoding="utf-8")

    response = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=auth)
    assert response.status_code == 404
    assert response.json()["code"] == 30001


def test_upload_requires_token(client: TestClient) -> None:
    response = client.post(
        "/api/v1/uploads",
        json={"original_name": "a.zip", "size_bytes": 1, "sha256": "0" * 64},
    )
    assert response.status_code == 401


def test_cleanup_expired_removes_stale_sessions(upload_settings: Settings) -> None:
    stale = upload_settings.data_dir / "uploads" / "stale-session"
    stale.mkdir(parents=True)
    (stale / SESSION_FILE).write_text(
        json.dumps({"created_at": (utcnow() - timedelta(days=2)).isoformat()}),
        encoding="utf-8",
    )
    fresh = upload_settings.data_dir / "uploads" / "fresh-session"
    fresh.mkdir(parents=True)
    (fresh / SESSION_FILE).write_text(
        json.dumps({"created_at": utcnow().isoformat()}), encoding="utf-8"
    )

    removed = cleanup_expired(upload_settings)
    assert removed == 1
    assert not stale.exists()
    assert fresh.exists()
