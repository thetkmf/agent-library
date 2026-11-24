"""Learning plans: CRUD, optimistic locking, milestone rules, progress (§9.8, B10)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from app.core.config import Settings
from app.db.models import Milestone
from app.main import create_app
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(token=TOKEN, data_dir=tmp_path / "data", _env_file=None)


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def create_plan(client: TestClient, auth: dict[str, str], **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "title": "学习 RAG",
        "goal": "掌握检索增强生成",
        "start_date": "2026-11-01",
        "target_date": "2026-12-31",
        "milestones": [
            {"title": "读论文", "sort_order": 0},
            {"title": "写 demo", "sort_order": 1},
        ],
    }
    body.update(overrides)
    response = client.post("/api/v1/learning/plans", json=body, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_create_list_and_detail(client: TestClient, auth: dict[str, str]) -> None:
    plan = create_plan(client, auth)
    assert plan["status"] == "planning"
    assert plan["version"] == 1
    assert [row["title"] for row in plan["milestones"]] == ["读论文", "写 demo"]

    listing = client.get("/api/v1/learning/plans", headers=auth).json()["data"]
    assert listing["total"] == 1
    assert listing["has_more"] is False

    detail = client.get(f"/api/v1/learning/plans/{plan['id']}", headers=auth).json()["data"]
    assert detail["id"] == plan["id"]
    assert client.get("/api/v1/learning/plans/nope", headers=auth).status_code == 404


def test_create_rejects_bad_date_range(client: TestClient, auth: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/learning/plans",
        json={
            "title": "倒序日期",
            "start_date": "2026-12-01",
            "target_date": "2026-11-01",
        },
        headers=auth,
    )
    assert response.status_code == 422
    assert response.json()["code"] == 40001


def test_update_requires_matching_version(client: TestClient, auth: dict[str, str]) -> None:
    plan = create_plan(client, auth)
    ok = client.patch(
        f"/api/v1/learning/plans/{plan['id']}",
        json={"expected_version": 1, "title": "学习 RAG v2", "status": "active"},
        headers=auth,
    )
    assert ok.status_code == 200
    assert ok.json()["data"]["title"] == "学习 RAG v2"
    assert ok.json()["data"]["version"] == 2

    conflict = client.patch(
        f"/api/v1/learning/plans/{plan['id']}",
        json={"expected_version": 1, "title": "过期版本"},
        headers=auth,
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == 30003
    assert conflict.json()["data"]["version"] == 2


def test_milestone_rules_bump_plan_version(client: TestClient, auth: dict[str, str]) -> None:
    plan = create_plan(client, auth)
    milestone = plan["milestones"][0]

    added = client.post(
        f"/api/v1/learning/plans/{plan['id']}/milestones",
        json={"title": "第三项"},
        headers=auth,
    )
    assert added.status_code == 201
    assert added.json()["data"]["sort_order"] == 2
    after_add = client.get(f"/api/v1/learning/plans/{plan['id']}", headers=auth).json()["data"]
    assert after_add["version"] == 2

    done = client.patch(
        f"/api/v1/learning/milestones/{milestone['id']}", json={"status": "done"}, headers=auth
    ).json()["data"]
    assert done["status"] == "done"
    assert done["progress"] == 100
    assert done["completed_at"] is not None

    reopened = client.patch(
        f"/api/v1/learning/milestones/{milestone['id']}",
        json={"progress": 40},
        headers=auth,
    ).json()["data"]
    assert reopened["status"] == "in_progress"
    assert reopened["progress"] == 40
    assert reopened["completed_at"] is None

    full = client.patch(
        f"/api/v1/learning/milestones/{milestone['id']}", json={"progress": 100}, headers=auth
    ).json()["data"]
    assert full["status"] == "done"

    final = client.get(f"/api/v1/learning/plans/{plan['id']}", headers=auth).json()["data"]
    assert final["version"] == 5  # 创建 + 新增里程碑 + 三次更新

    deleted = client.delete(f"/api/v1/learning/milestones/{milestone['id']}", headers=auth)
    assert deleted.status_code == 200
    assert (
        client.patch(
            "/api/v1/learning/milestones/nope", json={"progress": 1}, headers=auth
        ).status_code
        == 404
    )


def test_progress_and_streak(client: TestClient, auth: dict[str, str]) -> None:
    plan = create_plan(client, auth)
    empty = client.get("/api/v1/learning/progress", headers=auth).json()["data"]
    assert empty["total_plans"] == 1
    assert empty["milestone_total"] == 2
    assert empty["completion_rate"] == 0.0
    assert empty["streak_days"] == 0

    factory = client.app.state.session_factory
    zone_today = date.today()
    with factory() as session:
        rows = session.query(Milestone).filter(Milestone.plan_id == plan["id"]).all()
        rows[0].status = "done"
        rows[0].progress = 100
        rows[0].completed_at = datetime.now(UTC).replace(tzinfo=None)
        rows[1].status = "done"
        rows[1].progress = 100
        rows[1].completed_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        session.commit()

    progress = client.get("/api/v1/learning/progress", headers=auth).json()["data"]
    assert progress["milestone_done"] == 2
    assert progress["completion_rate"] == 1.0
    assert progress["streak_days"] >= 1
    assert progress["updated_at"] is not None
    assert zone_today


def test_delete_plan_cascades(client: TestClient, auth: dict[str, str]) -> None:
    plan = create_plan(client, auth)
    assert client.delete(f"/api/v1/learning/plans/{plan['id']}", headers=auth).status_code == 200
    assert client.get(f"/api/v1/learning/plans/{plan['id']}", headers=auth).status_code == 404
    factory = client.app.state.session_factory
    with factory() as session:
        assert session.query(Milestone).count() == 0


def test_learning_requires_token(client: TestClient) -> None:
    assert client.get("/api/v1/learning/plans").status_code == 401
    assert client.get("/api/v1/learning/progress").status_code == 401
