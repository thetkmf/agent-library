"""Small file upload and download contract (§6.1, §6.3)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from app.core.config import Settings
from app.db.models import FileAsset, Item
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import select

MARKDOWN = "# 上传测试\n内容".encode()


def upload(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    filename: str = "笔记.md",
    content: bytes = MARKDOWN,
    mime: str = "text/markdown",
    title: str | None = None,
    tags: str | None = None,
) -> tuple[int, Any]:
    data: dict[str, str] = {}
    if title is not None:
        data["title"] = title
    if tags is not None:
        data["tags"] = tags
    response = client.post(
        "/api/v1/files",
        files={"file": (filename, content, mime)},
        data=data,
        headers=auth_headers,
    )
    return response.status_code, response.json()


def test_upload_creates_item_and_asset(
    client: TestClient, auth_headers: dict[str, str], settings: Settings
) -> None:
    status, body = upload(client, auth_headers, tags="学习, 资料")
    assert status == 201, body
    data = body["data"]
    item = data["item"]
    asset = data["file_asset"]

    assert item["type"] == "file"
    assert item["title"] == "笔记.md"
    assert item["status"] == "active"
    assert item["version"] == 1
    assert {tag["name"] for tag in item["tags"]} == {"学习", "资料"}
    assert item["file"]["id"] == asset["id"]
    assert asset["size_bytes"] == len(MARKDOWN)
    assert len(asset["sha256"]) == 64
    assert asset["download_url"] == f"/files/{asset['id']}/download"

    stored = settings.data_dir / "files" / asset["id"]
    assert not stored.exists()  # 目录按 yyyy/mm/uuid 组织，不按 asset id
    files_dir = settings.data_dir / "files"
    saved = list(files_dir.rglob("*.md"))
    assert len(saved) == 1
    assert saved[0].read_bytes() == MARKDOWN


def test_uploaded_file_listed_through_items(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    upload(client, auth_headers)
    listed = client.get("/api/v1/items", params={"type": "file"}, headers=auth_headers).json()[
        "data"
    ]
    assert listed["total"] == 1
    assert listed["items"][0]["file"]["download_url"].startswith("/files/")


def test_upload_rejects_unknown_extension(client: TestClient, auth_headers: dict[str, str]) -> None:
    status, body = upload(
        client, auth_headers, filename="恶意.exe", mime="application/x-msdownload"
    )
    assert status == 415
    assert body["code"] == 40003


def test_upload_rejects_mime_mismatch(client: TestClient, auth_headers: dict[str, str]) -> None:
    status, body = upload(client, auth_headers, filename="图片.png", mime="application/pdf")
    assert status == 415
    assert body["code"] == 40003


def test_upload_requires_token(client: TestClient) -> None:
    response = client.post("/api/v1/files", files={"file": ("a.md", b"x", "text/markdown")})
    assert response.status_code == 401


def test_upload_size_limit(tmp_path: Path) -> None:
    settings = Settings(
        token="test-token-0123456789abcdef",
        data_dir=tmp_path / "data",
        max_small_file_bytes=64,
        _env_file=None,
    )
    with TestClient(create_app(settings)) as client:
        headers = {"Authorization": "Bearer test-token-0123456789abcdef"}
        status, body = upload(client, headers, content=b"x" * 65)
    assert status == 413
    assert body["code"] == 40004


def test_upload_sanitises_filename(
    client: TestClient, auth_headers: dict[str, str], settings: Settings
) -> None:
    status, body = upload(client, auth_headers, filename="../..\\危险\x01 名.md")
    assert status == 201
    asset = body["data"]["file_asset"]
    name = asset["original_name"]
    assert ".." not in name
    assert "/" not in name and "\\\\" not in name
    saved = list((settings.data_dir / "files").rglob("*.md"))
    assert len(saved) == 1
    assert settings.data_dir in saved[0].parents


def test_download_full_and_range(client: TestClient, auth_headers: dict[str, str]) -> None:
    payload = b"0123456789abcdef"
    _, body = upload(client, auth_headers, filename="数据.txt", content=payload, mime="text/plain")
    asset = body["data"]["file_asset"]
    url = f"/api/v1/files/{asset['id']}/download"

    full = client.get(url, headers=auth_headers)
    assert full.status_code == 200
    assert full.content == payload
    assert full.headers["accept-ranges"] == "bytes"
    assert "filename*=UTF-8''" in full.headers["content-disposition"]

    part = client.get(url, headers={**auth_headers, "Range": "bytes=2-5"})
    assert part.status_code == 206
    assert part.content == payload[2:6]
    assert part.headers["content-range"] == f"bytes 2-5/{len(payload)}"

    suffix = client.get(url, headers={**auth_headers, "Range": "bytes=-3"})
    assert suffix.status_code == 206
    assert suffix.content == payload[-3:]

    open_ended = client.get(url, headers={**auth_headers, "Range": "bytes=10-"})
    assert open_ended.status_code == 206
    assert open_ended.content == payload[10:]

    beyond = client.get(url, headers={**auth_headers, "Range": f"bytes={len(payload)}-"})
    assert beyond.status_code == 416


def test_download_recycled_and_missing(client: TestClient, auth_headers: dict[str, str]) -> None:
    _, body = upload(client, auth_headers)
    item_id = body["data"]["item"]["id"]
    asset_id = body["data"]["file_asset"]["id"]

    unknown = client.get(
        "/api/v1/files/0199cccccccccccccccccccccccccccc/download", headers=auth_headers
    )
    assert unknown.status_code == 404
    assert unknown.json()["code"] == 30001

    client.delete(f"/api/v1/items/{item_id}", headers=auth_headers)
    recycled = client.get(f"/api/v1/files/{asset_id}/download", headers=auth_headers)
    assert recycled.status_code == 404
    assert recycled.json()["code"] == 30001

    client.post(f"/api/v1/items/{item_id}/restore", headers=auth_headers)
    factory = client.app.state.session_factory
    with factory() as session:
        asset = session.scalars(select(FileAsset).where(FileAsset.id == asset_id)).one()
        relative = asset.relative_path
        assert not Path(relative).is_absolute()  # 只存相对路径

    # 删除磁盘文件后下载应返回 410 + 30001
    from app.services.storage import StorageService

    storage = StorageService(client.app.state.settings)
    storage.absolute_path(relative).unlink()
    missing = client.get(f"/api/v1/files/{asset_id}/download", headers=auth_headers)
    assert missing.status_code == 410
    assert missing.json()["code"] == 30001


def test_download_requires_token(client: TestClient, auth_headers: dict[str, str]) -> None:
    _, body = upload(client, auth_headers)
    asset_id = body["data"]["file_asset"]["id"]
    assert client.get(f"/api/v1/files/{asset_id}/download").status_code == 401


def test_upload_rollback_leaves_no_orphan_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(
        token="test-token-0123456789abcdef",
        data_dir=tmp_path / "data",
        _env_file=None,
    )
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = {"Authorization": "Bearer test-token-0123456789abcdef"}

        import app.services.files as files_service

        original = files_service.items_repo.ensure_tags

        def boom(session: Any, names: Any) -> Any:
            raise RuntimeError("tag failure")

        monkeypatch.setattr(files_service.items_repo, "ensure_tags", boom)
        response = client.post(
            "/api/v1/files",
            files={"file": ("回滚.md", b"abc", "text/markdown")},
            data={"tags": "x"},
            headers=headers,
        )
        monkeypatch.setattr(files_service.items_repo, "ensure_tags", original)
        assert response.status_code == 500

        files_dir = settings.data_dir / "files"
        leftovers = [p for p in files_dir.rglob("*") if p.is_file()] if files_dir.exists() else []
        assert leftovers == []
        factory = app.state.session_factory
        with factory() as session:
            assert session.scalars(select(Item)).all() == []


def test_windows_reserved_names_are_escaped(
    client: TestClient, auth_headers: dict[str, str], settings: Settings
) -> None:
    for name in ("CON.md", "NUL.txt", "com1.txt"):
        status, body = upload(client, auth_headers, filename=name)
        assert status == 201, (name, body)
        asset = body["data"]["file_asset"]
        assert asset["original_name"].startswith("_")
        assert asset["size_bytes"] == len(MARKDOWN)

    saved = [path for path in (settings.data_dir / "files").rglob("*.md") if path.is_file()]
    assert saved and all(path.stat().st_size > 0 for path in saved)


def test_text_mime_family_is_enforced(client: TestClient, auth_headers: dict[str, str]) -> None:
    rejected = upload(client, auth_headers, filename="笔记.md", mime="application/pdf")
    assert rejected[0] == 415
    assert rejected[1]["code"] == 40003

    accepted_text = upload(
        client, auth_headers, filename="纯文本.txt", content=b"abc", mime="text/plain"
    )
    assert accepted_text[0] == 201

    accepted_binary = upload(
        client, auth_headers, filename="未知.md", content=b"abc", mime="application/octet-stream"
    )
    assert accepted_binary[0] == 201


def test_download_streams_instead_of_reading_whole_file(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"x" * (3 * 1024 * 1024)
    _, body = upload(
        client, auth_headers, filename="大文件.txt", content=payload, mime="text/plain"
    )
    asset = body["data"]["file_asset"]

    def boom(self: Path) -> bytes:
        raise AssertionError("下载不应整文件读入内存")

    monkeypatch.setattr(Path, "read_bytes", boom)
    full = client.get(f"/api/v1/files/{asset['id']}/download", headers=auth_headers)
    assert full.status_code == 200
    assert len(full.content) == len(payload)

    head = client.get(
        f"/api/v1/files/{asset['id']}/download",
        headers={**auth_headers, "Range": "bytes=0-1023"},
    )
    assert head.status_code == 206
    assert len(head.content) == 1024


def test_disk_full_maps_to_storage_full(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.storage as storage_module

    class Usage:
        total = 10
        used = 10
        free = 0

    monkeypatch.setattr(storage_module.shutil, "disk_usage", lambda _path: Usage())
    status, body = upload(client, auth_headers)
    assert status == 507
    assert body["code"] == 60002
