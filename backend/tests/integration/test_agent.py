"""Agent: SSE chat, conversations, tool loop and failure semantics (§9.6, B7)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from app.core.config import Settings
from app.main import create_app
from app.services.agent import AgentService
from app.services.embedding import DeterministicEmbedder, EmbeddingService
from app.services.indexing import IndexService
from app.services.llm import StreamChunk, ToolCallDelta
from app.services.search import SearchService
from app.services.vector_store import MemoryVectorStore
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"
DIMENSION = 8


class FakeClient:
    """Scripted stand-in for DeepSeekClient: one entry per astream() call."""

    def __init__(self, script: list[list[StreamChunk]]) -> None:
        self.script = script
        self.calls: list[list[dict[str, Any]]] = []
        self.closed = False

    async def astream(self, messages: Any, *, tools: Any = None) -> AsyncIterator[StreamChunk]:
        self.calls.append(list(messages))
        round_chunks = self.script.pop(0) if self.script else []
        for chunk in round_chunks:
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


class FailingClient(FakeClient):
    async def astream(self, messages: Any, *, tools: Any = None) -> AsyncIterator[StreamChunk]:
        from app.core.errors import AppError, ErrorCode

        raise AppError(ErrorCode.MODEL_CALL_FAILED, "模型服务返回错误", http_status=502)
        yield StreamChunk()  # pragma: no cover


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        embedding_dimension=DIMENSION,
        chunk_chars=200,
        chunk_overlap_chars=10,
        privacy_allow_external_calls=True,
        deepseek_api_key="sk-test-key-not-real",
        agent_sse_heartbeat_s=30.0,
        _env_file=None,
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def install_agent(client: TestClient, script: list[list[StreamChunk]]) -> FakeClient:
    state = client.app.state
    store = MemoryVectorStore()
    embedder = EmbeddingService(state.settings, embedder=DeterministicEmbedder(dimension=DIMENSION))
    state.vector_store = store
    state.index_service = IndexService(
        state.settings, state.session_factory, store, embedder, synchronous=True
    )
    search_service = SearchService(state.settings, state.session_factory, store, embedder)
    state.search_service = search_service
    fake = FakeClient(script)
    state.agent_service = AgentService(
        state.settings,
        state.session_factory,
        search_service,
        client_factory=lambda _settings, _key: fake,  # type: ignore[arg-type]
    )
    return fake


def text_chunks(*parts: str) -> list[StreamChunk]:
    return [StreamChunk(content=part) for part in parts] + [StreamChunk(finish_reason="stop")]


def _detail(client: TestClient, auth: dict[str, str], conversation_id: str) -> dict[str, Any]:
    response = client.get(f"/api/v1/agent/conversations/{conversation_id}", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def sse_events(
    client: TestClient,
    auth: dict[str, str],
    body: dict[str, Any],
) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    with client.stream("POST", "/api/v1/agent/chat", json=body, headers=auth) as response:
        assert response.status_code == 200, response.read()
        assert response.headers["content-type"].startswith("text/event-stream")
        name: str | None = None
        for line in response.iter_lines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and name:
                events.append((name, json.loads(line.split(":", 1)[1].strip())))
    return events


def create_note(
    client: TestClient, auth: dict[str, str], title: str, content: str
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/items",
        json={"type": "note", "title": title, "content": content},
        headers=auth,
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_chat_streams_and_persists(client: TestClient, auth: dict[str, str]) -> None:
    fake = install_agent(client, [text_chunks("你好", "，这是回答。")])
    events = sse_events(
        client,
        auth,
        {"messages": [{"role": "user", "content": "你好，介绍一下知识库"}]},
    )
    names = [name for name, _data in events]
    assert names[0] == "message.started"
    assert "message.delta" in names
    assert names[-1] == "message.completed"

    started = events[0][1]
    completed = events[-1][1]
    assert started["message_id"] == completed["message_id"]
    assert completed["finish_reason"] == "stop"
    assert completed["tool_calling"] is False
    assert completed["citations"] == []
    assert (
        "".join(data["delta"] for name, data in events if name == "message.delta")
        == "你好，这是回答。"
    )
    assert fake.closed is True

    detail = client.get(
        f"/api/v1/agent/conversations/{started['conversation_id']}", headers=auth
    ).json()["data"]
    assert detail["title"] == "你好，介绍一下知识库"[:30]
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["content"] == "你好，这是回答。"


def test_chat_requires_key_and_external_permission(
    client: TestClient, auth: dict[str, str], settings: Settings
) -> None:
    install_agent(client, [text_chunks("不该被调用")])
    client.app.state.settings = settings.model_copy(update={"deepseek_api_key": None})
    client.app.state.agent_service.settings = client.app.state.settings
    response = client.post(
        "/api/v1/agent/chat",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers=auth,
    )
    assert response.status_code == 409
    assert response.json()["code"] == 50001

    client.app.state.settings = settings.model_copy(update={"privacy_allow_external_calls": False})
    client.app.state.agent_service.settings = client.app.state.settings
    blocked = client.post(
        "/api/v1/agent/chat",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers=auth,
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == 50001


def test_chat_validates_request(client: TestClient, auth: dict[str, str]) -> None:
    install_agent(client, [])
    assert (
        client.post(
            "/api/v1/agent/chat",
            json={"messages": [{"role": "user", "content": "hi"}], "stream": False},
            headers=auth,
        ).json()["code"]
        == 40002
    )
    assert (
        client.post(
            "/api/v1/agent/chat",
            json={"messages": [{"role": "assistant", "content": "hi"}]},
            headers=auth,
        ).json()["code"]
        == 40002
    )
    too_many = client.post(
        "/api/v1/agent/chat",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context_item_ids": [f"missing-{index}" for index in range(21)],
        },
        headers=auth,
    )
    assert too_many.status_code == 400
    assert too_many.json()["code"] == 40002

    missing = client.post(
        "/api/v1/agent/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "context_item_ids": ["nope"]},
        headers=auth,
    )
    assert missing.status_code == 404
    assert missing.json()["code"] == 30001


def test_context_item_ids_reach_model(client: TestClient, auth: dict[str, str]) -> None:
    note = create_note(client, auth, "上下文笔记", "被引用的内容")
    fake = install_agent(client, [text_chunks("收到")])
    sse_events(
        client,
        auth,
        {
            "messages": [{"role": "user", "content": "看看这条"}],
            "context_item_ids": [note["id"]],
        },
    )
    system_text = "\n".join(
        str(message.get("content")) for message in fake.calls[0] if message.get("role") == "system"
    )
    assert "上下文笔记" in system_text
    assert note["id"] in system_text


def test_tool_loop_produces_citations(client: TestClient, auth: dict[str, str]) -> None:
    fake = install_agent(client, [])
    note = create_note(client, auth, "向量检索笔记", "向量检索用嵌入做语义匹配。")
    assert client.post("/api/v1/index/reindex", json={}, headers=auth).status_code == 202

    tool_round = [
        StreamChunk(
            tool_calls=[
                ToolCallDelta(
                    index=0,
                    call_id="call_1",
                    name="search_knowledge",
                    arguments='{"query": "向量检索"}',
                )
            ]
        ),
        StreamChunk(finish_reason="tool_calls"),
    ]
    fake.script = [tool_round, text_chunks("根据你的笔记，", "向量检索很常用。")]
    events = sse_events(client, auth, {"messages": [{"role": "user", "content": "向量检索是什么"}]})

    completed = events[-1][1]
    assert completed["tool_calling"] is True
    assert [citation["item_id"] for citation in completed["citations"]] == [note["id"]]
    assert len(fake.calls) == 2
    assert any(message.get("role") == "tool" for message in fake.calls[1])

    conversation_id = events[0][1]["conversation_id"]
    detail = client.get(f"/api/v1/agent/conversations/{conversation_id}", headers=auth).json()[
        "data"
    ]
    assistant = detail["messages"][-1]
    assert assistant["tool_calls"][0]["name"] == "search_knowledge"
    assert assistant["citations"][0]["item_id"] == note["id"]


def test_tool_loop_stops_at_limit(client: TestClient, auth: dict[str, str]) -> None:
    def tool_round(name: str) -> list[StreamChunk]:
        return [
            StreamChunk(
                tool_calls=[
                    ToolCallDelta(index=0, call_id=f"call_{name}", name="list_tags", arguments="{}")
                ]
            ),
            StreamChunk(finish_reason="tool_calls"),
        ]

    fake = install_agent(client, [tool_round(str(index)) for index in range(6)])
    events = sse_events(client, auth, {"messages": [{"role": "user", "content": "列标签"}]})
    assert len(fake.calls) == 4
    assert events[-1][0] == "message.completed"
    assert events[-1][1]["tool_calling"] is True


def test_bad_tool_arguments_do_not_break_stream(client: TestClient, auth: dict[str, str]) -> None:
    tool_round = [
        StreamChunk(
            tool_calls=[
                ToolCallDelta(index=0, call_id="call_x", name="get_item", arguments="{not json")
            ]
        ),
        StreamChunk(finish_reason="tool_calls"),
    ]
    install_agent(client, [tool_round, text_chunks("没有找到")])
    events = sse_events(client, auth, {"messages": [{"role": "user", "content": "读一下"}]})
    assert events[-1][0] == "message.completed"


def test_upstream_failure_emits_error_and_skips_persistence(
    client: TestClient, auth: dict[str, str]
) -> None:
    install_agent(client, [])
    client.app.state.agent_service.client_factory = lambda _settings, _key: FailingClient([])
    events = sse_events(client, auth, {"messages": [{"role": "user", "content": "会失败"}]})
    assert [name for name, _ in events] == ["message.started", "error"]
    assert events[-1][1]["code"] == 50002

    conversation_id = events[0][1]["conversation_id"]
    detail = client.get(f"/api/v1/agent/conversations/{conversation_id}", headers=auth).json()[
        "data"
    ]
    assert detail["messages"] == []


def test_conversation_list_detail_delete(client: TestClient, auth: dict[str, str]) -> None:
    install_agent(client, [text_chunks("一"), text_chunks("二")])
    first = sse_events(client, auth, {"messages": [{"role": "user", "content": "第一个会话"}]})
    second = sse_events(client, auth, {"messages": [{"role": "user", "content": "第二个会话"}]})

    listing = client.get("/api/v1/agent/conversations", headers=auth).json()["data"]
    assert listing["total"] == 2
    assert [row["title"] for row in listing["items"]] == ["第二个会话", "第一个会话"]
    assert listing["items"][0]["message_count"] == 2

    conversation_id = first[0][1]["conversation_id"]
    assert (
        client.delete(f"/api/v1/agent/conversations/{conversation_id}", headers=auth).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/agent/conversations/{conversation_id}", headers=auth).status_code
        == 404
    )
    assert client.get("/api/v1/agent/conversations", headers=auth).json()["data"]["total"] == 1
    assert second[0][1]["conversation_id"]


def test_continue_existing_conversation(client: TestClient, auth: dict[str, str]) -> None:
    fake = install_agent(client, [text_chunks("第一轮"), text_chunks("第二轮")])
    first = sse_events(client, auth, {"messages": [{"role": "user", "content": "问题一"}]})
    conversation_id = first[0][1]["conversation_id"]

    sse_events(
        client,
        auth,
        {
            "conversation_id": conversation_id,
            "messages": [{"role": "user", "content": "问题二"}],
        },
    )
    second_call = fake.calls[1]
    contents = [message.get("content") for message in second_call]
    assert "问题一" in contents
    assert "第一轮" in contents
    assert contents[-1] == "问题二"

    detail = client.get(f"/api/v1/agent/conversations/{conversation_id}", headers=auth).json()[
        "data"
    ]
    assert [message["content"] for message in detail["messages"]] == [
        "问题一",
        "第一轮",
        "问题二",
        "第二轮",
    ]


def test_agent_endpoints_require_token(client: TestClient) -> None:
    assert client.get("/api/v1/agent/conversations").status_code == 401
    assert client.post("/api/v1/agent/chat", json={"messages": []}).status_code == 401
