"""AI automation: tasks, suggestions, profile, graph build (§9.6, B8)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from app.core.config import Settings
from app.db.models import AiTask
from app.main import create_app
from app.services.ai_tasks import AiTaskService
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"


class FakeModel:
    """Deterministic stand-in for DeepSeek: replies by prompt keyword."""

    def __init__(self, *, fail: bool = False) -> None:
        self.prompts: list[str] = []
        self.fail = fail

    def __call__(self, messages: list[dict[str, Any]]) -> str:
        prompt = messages[-1]["content"]
        self.prompts.append(prompt)
        if self.fail:
            raise RuntimeError("model down")
        if "标签" in prompt and "推荐" in prompt:
            return json.dumps({"tags": ["ML", "向量检索"]}, ensure_ascii=False)
        if "最相关" in prompt:
            target = ""
            for line in prompt.splitlines():
                if line.startswith("- id=") and "候选" not in line:
                    target = line.split("id=", 1)[1].split()[0]
                    break
            return json.dumps(
                {"links": [{"target_item_id": target, "reason": "主题接近"}]},
                ensure_ascii=False,
            )
        if "画像" in prompt:
            return json.dumps(
                {
                    "interests": ["机器学习"],
                    "knowledge_domains": [{"domain": "检索", "level": "入门"}],
                    "learning_goals": ["掌握 RAG"],
                    "preferred_style": "简洁",
                },
                ensure_ascii=False,
            )
        return json.dumps({"summary": "这是一段自动摘要"}, ensure_ascii=False)


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        privacy_allow_external_calls=True,
        deepseek_api_key="sk-test-key-not-real",
        _env_file=None,
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def install_ai(client: TestClient, model: FakeModel | None = None) -> FakeModel:
    fake = model or FakeModel()
    client.app.state.ai_task_service = AiTaskService(
        client.app.state.settings,
        client.app.state.session_factory,
        completion=fake,
        synchronous=True,
    )
    return fake


def create_note(
    client: TestClient, auth: dict[str, str], title: str, content: str
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/items", json={"type": "note", "title": title, "content": content}, headers=auth
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_summarize_task_writes_ai_summary(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    note = create_note(client, auth, "向量检索", "向量检索用嵌入做语义匹配。")
    response = client.post("/api/v1/ai/tasks", json={"type": "summarize"}, headers=auth)
    assert response.status_code == 202, response.text
    task = response.json()["data"]
    assert task["type"] == "summarize"
    assert task["status"] == "succeeded"
    assert task["progress"] == 100
    assert task["result"] == {"updated_items": 1, "failures": []}

    detail = client.get(f"/api/v1/items/{note['id']}", headers=auth).json()["data"]
    assert detail["ai_summary"] == "这是一段自动摘要"


def test_tasks_require_model_configuration(
    client: TestClient, auth: dict[str, str], settings: Settings
) -> None:
    install_ai(client)
    client.app.state.ai_task_service.settings = settings.model_copy(
        update={"deepseek_api_key": None}
    )
    response = client.post("/api/v1/ai/tasks", json={"type": "summarize"}, headers=auth)
    assert response.status_code == 409
    assert response.json()["code"] == 50001
    listing = client.get("/api/v1/ai/tasks", headers=auth).json()["data"]
    assert listing["total"] == 0


def test_tagging_creates_suggestions_and_accept_applies(
    client: TestClient, auth: dict[str, str]
) -> None:
    install_ai(client)
    note = create_note(client, auth, "机器学习笔记", "讲讲嵌入与检索。")
    task = client.post("/api/v1/ai/tasks", json={"type": "tagging"}, headers=auth).json()["data"]
    assert task["result"]["suggestions_created"] == 1

    listing = client.get(
        "/api/v1/ai/suggestions", params={"status": "pending", "type": "tag"}, headers=auth
    ).json()["data"]
    assert listing["total"] == 1
    suggestion = listing["items"][0]
    assert suggestion["payload"]["tags"] == ["ML", "向量检索"]

    accepted = client.post(
        f"/api/v1/ai/suggestions/{suggestion['id']}/accept", headers=auth
    ).json()["data"]
    assert accepted["status"] == "accepted"
    assert accepted["decided_at"] is not None

    detail = client.get(f"/api/v1/items/{note['id']}", headers=auth).json()["data"]
    assert {tag["name"] for tag in detail["tags"]} == {"ML", "向量检索"}

    again = client.post(f"/api/v1/ai/suggestions/{suggestion['id']}/accept", headers=auth)
    assert again.status_code == 200
    assert again.json()["data"]["status"] == "accepted"

    conflict = client.post(f"/api/v1/ai/suggestions/{suggestion['id']}/reject", headers=auth)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == 30002


def test_reject_then_accept_conflicts(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    create_note(client, auth, "拒绝测试", "内容")
    client.post("/api/v1/ai/tasks", json={"type": "tagging"}, headers=auth)
    suggestion = client.get("/api/v1/ai/suggestions", headers=auth).json()["data"]["items"][0]

    rejected = client.post(f"/api/v1/ai/suggestions/{suggestion['id']}/reject", headers=auth)
    assert rejected.status_code == 200
    assert rejected.json()["data"]["status"] == "rejected"

    again = client.post(f"/api/v1/ai/suggestions/{suggestion['id']}/reject", headers=auth)
    assert again.status_code == 200

    conflict = client.post(f"/api/v1/ai/suggestions/{suggestion['id']}/accept", headers=auth)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == 30002


def test_linking_suggestion_accept_creates_edge(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    first = create_note(client, auth, "向量检索", "嵌入与相似度。")
    create_note(client, auth, "机器学习入门", "基础概念。")
    task = client.post("/api/v1/ai/tasks", json={"type": "linking"}, headers=auth).json()["data"]
    assert task["result"]["suggestions_created"] >= 1

    suggestions = client.get(
        "/api/v1/ai/suggestions", params={"type": "link"}, headers=auth
    ).json()["data"]["items"]
    assert suggestions
    payload = suggestions[0]["payload"]
    assert payload["relation"] == "related_to"
    assert payload["target_item_id"] != suggestions[0]["item_id"]

    accepted = client.post(f"/api/v1/ai/suggestions/{suggestions[0]['id']}/accept", headers=auth)
    assert accepted.status_code == 200

    graph = client.post("/api/v1/ai/tasks", json={"type": "graph_build"}, headers=auth).json()[
        "data"
    ]
    assert graph["status"] == "succeeded"
    assert graph["result"]["nodes"] >= 2
    assert graph["result"]["edges"] >= 1
    assert first["id"]


def test_organize_combines_outputs(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    create_note(client, auth, "整理目标", "内容一")
    task = client.post("/api/v1/ai/tasks", json={"type": "organize"}, headers=auth).json()["data"]
    assert task["result"]["summaries_created"] == 1
    assert task["result"]["suggestions_created"] >= 1


def test_profile_refresh_and_read(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    empty = client.get("/api/v1/ai/profile", headers=auth).json()["data"]
    assert empty["interests"] == []
    assert empty["updated_at"] is None

    create_note(client, auth, "RAG 实践", "检索增强生成。")
    refresh = client.post("/api/v1/ai/profile/refresh", headers=auth)
    assert refresh.status_code == 202
    assert refresh.json()["data"]["type"] == "profile_refresh"
    assert refresh.json()["data"]["status"] == "succeeded"

    profile = client.get("/api/v1/ai/profile", headers=auth).json()["data"]
    assert profile["interests"] == ["机器学习"]
    assert profile["learning_goals"] == ["掌握 RAG"]
    assert profile["preferred_style"] == "简洁"
    assert profile["updated_at"] is not None


def test_task_cancel_rules(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    factory = client.app.state.session_factory
    with factory() as session:
        queued = AiTask(type="summarize", status="queued", progress=0, input_data={})
        session.add(queued)
        session.commit()
        queued_id = queued.id
    canceled = client.post(f"/api/v1/ai/tasks/{queued_id}/cancel", headers=auth)
    assert canceled.status_code == 200
    assert canceled.json()["data"]["status"] == "canceled"

    again = client.post(f"/api/v1/ai/tasks/{queued_id}/cancel", headers=auth)
    assert again.status_code == 409
    assert again.json()["code"] == 30002

    assert client.post("/api/v1/ai/tasks/nope/cancel", headers=auth).status_code == 404


def test_recover_interrupted_marks_failed(client: TestClient) -> None:
    install_ai(client)
    service: AiTaskService = client.app.state.ai_task_service
    factory = client.app.state.session_factory
    with factory() as session:
        running = AiTask(type="tagging", status="running", progress=40, input_data={})
        reindex = AiTask(type="reindex", status="running", progress=10, input_data={})
        session.add_all([running, reindex])
        session.commit()
        running_id, reindex_id = running.id, reindex.id

    assert service.recover_interrupted() == 2
    assert (
        client.get(f"/api/v1/ai/tasks/{running_id}", headers=auth_token()).json()["data"]["status"]
        == "failed"
    )
    with factory() as session:
        assert session.get(AiTask, reindex_id).status == "running"


def auth_token() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def test_task_failure_is_recorded(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client, FakeModel(fail=True))
    create_note(client, auth, "会失败", "内容")
    task = client.post("/api/v1/ai/tasks", json={"type": "summarize"}, headers=auth).json()["data"]
    assert task["status"] == "failed"
    assert task["error"]["code"] == 10001


def test_task_list_filters_and_pagination(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    create_note(client, auth, "列表测试", "内容")
    client.post("/api/v1/ai/tasks", json={"type": "summarize"}, headers=auth)
    client.post("/api/v1/ai/tasks", json={"type": "tagging"}, headers=auth)

    all_tasks = client.get("/api/v1/ai/tasks", headers=auth).json()["data"]
    assert all_tasks["total"] == 2
    assert all_tasks["has_more"] is False
    assert all_tasks["items"][0]["type"] == "tagging"

    filtered = client.get("/api/v1/ai/tasks", params={"type": "summarize"}, headers=auth).json()[
        "data"
    ]
    assert filtered["total"] == 1

    page = client.get("/api/v1/ai/tasks", params={"page": 1, "page_size": 1}, headers=auth).json()[
        "data"
    ]
    assert len(page["items"]) == 1
    assert page["has_more"] is True


def test_task_with_unknown_item_is_404(client: TestClient, auth: dict[str, str]) -> None:
    install_ai(client)
    response = client.post(
        "/api/v1/ai/tasks",
        json={"type": "summarize", "item_ids": ["does-not-exist"]},
        headers=auth,
    )
    assert response.status_code == 404
    assert response.json()["code"] == 30001


def test_ai_endpoints_require_token(client: TestClient) -> None:
    assert client.get("/api/v1/ai/tasks").status_code == 401
    assert client.post("/api/v1/ai/tasks", json={"type": "summarize"}).status_code == 401
    assert client.get("/api/v1/ai/suggestions").status_code == 401
    assert client.get("/api/v1/ai/profile").status_code == 401


def test_graph_build_with_tags_is_idempotent(client: TestClient, auth: dict[str, str]) -> None:
    """13.22 返修：带标签的条目首次建图曾经 FOREIGN KEY constraint failed。"""
    install_ai(client)
    create_note(client, auth, "向量检索", "嵌入检索。")
    tagged = client.post(
        "/api/v1/items",
        json={"type": "note", "title": "机器学习", "content": "基础。", "tags": ["ML", "检索"]},
        headers=auth,
    )
    assert tagged.status_code == 201

    first = client.post("/api/v1/ai/tasks", json={"type": "graph_build"}, headers=auth).json()[
        "data"
    ]
    assert first["status"] == "succeeded", first
    assert first["result"]["nodes"] == 4  # 2 个条目 + 2 个标签
    assert first["result"]["edges"] == 2  # 两个 tagged_with

    second = client.post("/api/v1/ai/tasks", json={"type": "graph_build"}, headers=auth).json()[
        "data"
    ]
    assert second["status"] == "succeeded", second
    assert second["result"] == first["result"]

    stats = client.get("/api/v1/graph/stats", headers=auth).json()["data"]
    assert stats["node_count"] == 4
    assert stats["edge_count"] == 2
