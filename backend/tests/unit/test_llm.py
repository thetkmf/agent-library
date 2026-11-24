"""DeepSeek gateway: SSE parsing and error mapping without any network (B7-0)."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.services.llm import (
    DeepSeekClient,
    StreamChunk,
    ToolCallDelta,
    ensure_model_ready,
    merge_tool_calls,
    resolve_api_key,
)


def settings(**overrides: object) -> Settings:
    base = {
        "token": "test-token-0123456789abcdef",
        "privacy_allow_external_calls": True,
        "deepseek_api_key": "sk-test-key-not-real",
        "_env_file": None,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


SSE_BODY = (
    'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n'
    'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n'
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",'
    '"function":{"name":"search_knowledge","arguments":"{\\"query\\":"}}]}}]}\n\n'
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
    '"function":{"arguments":"\\"向量\\"}"}}]}}]}\n\n'
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
    "data: [DONE]\n\n"
)


def make_client(handler) -> DeepSeekClient:
    return DeepSeekClient(
        settings(), "sk-test-key-not-real", transport=httpx.MockTransport(handler)
    )


async def collect(client: DeepSeekClient) -> list[StreamChunk]:
    return [chunk async for chunk in client.astream([{"role": "user", "content": "hi"}])]


def run_and_close(client: DeepSeekClient) -> list[StreamChunk]:
    """Drive the async iterator from a sync test (no pytest-asyncio needed)."""

    async def _run() -> list[StreamChunk]:
        try:
            return await collect(client)
        finally:
            await client.aclose()

    return asyncio.run(_run())


def test_astream_parses_content_and_tool_calls() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, content=SSE_BODY.encode())

    client = make_client(handler)
    chunks = run_and_close(client)

    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert str(captured["auth"]).startswith("Bearer sk-")
    text = "".join(chunk.content for chunk in chunks)
    assert text == "你好，世界"
    deltas = [delta for chunk in chunks for delta in chunk.tool_calls]
    assert len(deltas) == 2
    merged = merge_tool_calls(deltas)
    assert merged[0].call_id == "call_1"
    assert merged[0].name == "search_knowledge"
    assert merged[0].arguments == '{"query":"向量"}'
    assert chunks[-1].finish_reason == "tool_calls"


def test_context_length_error_maps_to_50004() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "maximum context length exceeded"}})

    client = make_client(handler)
    with pytest.raises(AppError) as excinfo:
        run_and_close(client)
    assert excinfo.value.code is ErrorCode.CONTEXT_TOO_LONG
    assert excinfo.value.http_status == 422


def test_upstream_error_maps_to_50002() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": {"message": "boom"}})

    client = make_client(handler)
    with pytest.raises(AppError) as excinfo:
        run_and_close(client)
    assert excinfo.value.code is ErrorCode.MODEL_CALL_FAILED
    assert excinfo.value.http_status == 502


def test_timeout_maps_to_50003() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=request)

    client = make_client(handler)
    with pytest.raises(AppError) as excinfo:
        run_and_close(client)
    assert excinfo.value.code is ErrorCode.MODEL_TIMEOUT
    assert excinfo.value.http_status == 504


def test_gate_requires_key_and_permission() -> None:
    with pytest.raises(AppError) as excinfo:
        ensure_model_ready(settings(privacy_allow_external_calls=False), "sk-x")
    assert excinfo.value.code is ErrorCode.MODEL_NOT_CONFIGURED
    assert excinfo.value.http_status == 409

    with pytest.raises(AppError) as excinfo:
        ensure_model_ready(settings(), None)
    assert excinfo.value.code is ErrorCode.MODEL_NOT_CONFIGURED


def test_settings_key_takes_precedence_over_keyring() -> None:
    assert resolve_api_key(settings(deepseek_api_key="  sk-env  ")) == "sk-env"


def test_api_key_not_in_settings_repr() -> None:
    assert "sk-test-key-not-real" not in repr(settings())


def test_tool_call_delta_defaults() -> None:
    delta = ToolCallDelta(index=0)
    assert delta.name == ""
    assert delta.arguments == ""
