"""Reminders: CRUD, repeat rollover, snooze, due firing and SSE stream (§9.7, B9)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from app.core.config import Settings
from app.db.models import Reminder
from app.main import create_app
from app.services.reminders import ReminderService
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        reminder_scheduler_enabled=False,
        _env_file=None,
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def create_reminder(
    client: TestClient,
    auth: dict[str, str],
    *,
    title: str = "喝水",
    minutes: int = 30,
    repeat_rule: str = "none",
    related_item_ids: list[str] | None = None,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/reminders",
        json={
            "title": title,
            "body": "别忘喝水",
            "remind_at": iso(datetime.now(UTC) + timedelta(minutes=minutes)),
            "repeat_rule": repeat_rule,
            "related_item_ids": related_item_ids or [],
        },
        headers=auth,
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_create_and_list(client: TestClient, auth: dict[str, str]) -> None:
    reminder = create_reminder(client, auth)
    assert reminder["status"] == "pending"
    assert reminder["repeat_rule"] == "none"

    listing = client.get("/api/v1/reminders", headers=auth).json()["data"]
    assert listing["total"] == 1
    assert listing["items"][0]["id"] == reminder["id"]

    filtered = client.get("/api/v1/reminders", params={"status": "done"}, headers=auth).json()[
        "data"
    ]
    assert filtered["total"] == 0


def test_create_rejects_past_time_and_missing_items(
    client: TestClient, auth: dict[str, str]
) -> None:
    past = client.post(
        "/api/v1/reminders",
        json={"title": "过去", "remind_at": iso(datetime.now(UTC) - timedelta(hours=2))},
        headers=auth,
    )
    assert past.status_code == 422
    assert past.json()["code"] == 40001

    missing = client.post(
        "/api/v1/reminders",
        json={
            "title": "关联不存在",
            "remind_at": iso(datetime.now(UTC) + timedelta(minutes=10)),
            "related_item_ids": ["nope"],
        },
        headers=auth,
    )
    assert missing.status_code == 404
    assert missing.json()["code"] == 30001


def test_done_spawns_next_occurrence(client: TestClient, auth: dict[str, str]) -> None:
    reminder = create_reminder(client, auth, repeat_rule="daily")
    done = client.post(f"/api/v1/reminders/{reminder['id']}/done", headers=auth)
    assert done.status_code == 200
    assert done.json()["data"]["status"] == "done"

    listing = client.get("/api/v1/reminders", headers=auth).json()["data"]
    assert listing["total"] == 2
    pending = [row for row in listing["items"] if row["status"] == "pending"]
    assert len(pending) == 1
    first_at = datetime.fromisoformat(reminder["remind_at"].replace("Z", "+00:00"))
    next_at = datetime.fromisoformat(pending[0]["remind_at"].replace("Z", "+00:00"))
    assert next_at - first_at == timedelta(days=1)

    again = client.post(f"/api/v1/reminders/{reminder['id']}/done", headers=auth)
    assert again.status_code == 200
    assert client.get("/api/v1/reminders", headers=auth).json()["data"]["total"] == 2


def test_snooze_and_conflicts(client: TestClient, auth: dict[str, str]) -> None:
    reminder = create_reminder(client, auth)
    snoozed = client.post(
        f"/api/v1/reminders/{reminder['id']}/snooze", json={"minutes": 15}, headers=auth
    )
    assert snoozed.status_code == 200
    assert snoozed.json()["data"]["status"] == "snoozed"
    assert snoozed.json()["data"]["snooze_until"] is not None

    bad = client.post(
        f"/api/v1/reminders/{reminder['id']}/snooze", json={"minutes": 0}, headers=auth
    )
    assert bad.status_code == 422

    client.delete(f"/api/v1/reminders/{reminder['id']}", headers=auth)
    conflict = client.post(f"/api/v1/reminders/{reminder['id']}/done", headers=auth)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == 30002
    snooze_conflict = client.post(
        f"/api/v1/reminders/{reminder['id']}/snooze", json={"minutes": 5}, headers=auth
    )
    assert snooze_conflict.status_code == 409


def test_update_reschedules(client: TestClient, auth: dict[str, str]) -> None:
    reminder = create_reminder(client, auth, title="原标题")
    updated = client.patch(
        f"/api/v1/reminders/{reminder['id']}",
        json={"title": "新标题", "remind_at": iso(datetime.now(UTC) + timedelta(hours=2))},
        headers=auth,
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["title"] == "新标题"
    assert updated.json()["data"]["remind_at"] != reminder["remind_at"]

    assert (
        client.patch("/api/v1/reminders/nope", json={"title": "x"}, headers=auth).status_code == 404
    )


def test_fire_due_publishes_once(client: TestClient, auth: dict[str, str]) -> None:
    service: ReminderService = client.app.state.reminder_service
    factory = client.app.state.session_factory
    due_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=2)
    with factory() as session:
        reminder = Reminder(title="已到点", remind_at=due_at, status="pending")
        session.add(reminder)
        session.commit()
        reminder_id = reminder.id

    fired = service.fire_due()
    assert [row.id for row in fired] == [reminder_id]

    again = service.fire_due()
    assert again == []

    detail = client.get("/api/v1/reminders", headers=auth).json()["data"]["items"][0]
    assert detail["status"] == "pending"


def test_snoozed_reminder_fires_and_returns_to_pending(
    client: TestClient, auth: dict[str, str]
) -> None:
    service: ReminderService = client.app.state.reminder_service
    reminder = create_reminder(client, auth)
    client.post(f"/api/v1/reminders/{reminder['id']}/snooze", json={"minutes": 5}, headers=auth)
    with client.app.state.session_factory() as session:
        row = session.get(Reminder, reminder["id"])
        row.snooze_until = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=5)
        session.commit()

    fired = service.fire_due()
    assert [row.id for row in fired] == [reminder["id"]]
    after = client.get("/api/v1/reminders", headers=auth).json()["data"]["items"][0]
    assert after["status"] == "pending"
    assert after["snooze_until"] is None


def test_lock_screen_transitions(client: TestClient, auth: dict[str, str]) -> None:
    reminder = create_reminder(client, auth)
    assert client.get("/api/v1/reminders", headers=auth).status_code == 200
    listing = client.get(
        "/api/v1/reminders",
        params={"from": iso(datetime.now(UTC)), "to": iso(datetime.now(UTC) + timedelta(days=1))},
        headers=auth,
    ).json()["data"]
    assert listing["total"] == 1
    assert reminder["id"]


def test_events_stream_receives_reminder_due(client: TestClient, auth: dict[str, str]) -> None:
    import threading
    import time

    service: ReminderService = client.app.state.reminder_service
    with client.app.state.session_factory() as session:
        session.add(
            Reminder(
                title="流事件",
                remind_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1),
                status="pending",
            )
        )
        session.commit()

    def fire_later() -> None:
        time.sleep(0.5)
        service.fire_due()

    threading.Thread(target=fire_later, daemon=True).start()

    events: list[tuple[str, dict[str, Any]]] = []
    with client.stream("GET", "/api/v1/events/stream", headers=auth) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        name: str | None = None
        for line in response.iter_lines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and name:
                import json

                events.append((name, json.loads(line.split(":", 1)[1].strip())))
                break
    assert events and events[0][0] == "reminder.due"
    assert events[0][1]["title"] == "流事件"


def test_reminder_endpoints_require_token(client: TestClient) -> None:
    assert client.get("/api/v1/reminders").status_code == 401
    assert client.get("/api/v1/events/stream").status_code == 401
