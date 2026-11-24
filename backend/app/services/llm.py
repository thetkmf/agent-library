"""DeepSeek gateway (B7-0).

仅访问固定地址 ``https://api.deepseek.com`` 的 OpenAI 兼容接口：
- Key 从环境变量或 Windows 凭据管理器读取，永不落日志、不回显；
- ``privacy.allow_external_calls`` 未开启或没有 Key 时直接 409 + ``50001``，不发出请求；
- 测试通过注入假客户端（见 tests）实现零外联。
"""

from __future__ import annotations

import importlib
import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.config import MODEL_BASE_URL, Settings
from ..core.errors import AppError, ErrorCode
from ..core.logging import get_logger

logger = get_logger("pkb.llm")

KEYRING_SERVICE = "pkb-deepseek"
KEYRING_USERNAME = "api_key"
CHAT_PATH = "/chat/completions"


@dataclass(slots=True)
class ToolCallDelta:
    """流式返回的工具调用片段（同一次调用分散在多个 chunk 里）。"""

    index: int
    call_id: str = ""
    name: str = ""
    arguments: str = ""


@dataclass(slots=True)
class ToolCall:
    """聚合完成的工具调用。"""

    call_id: str
    name: str
    arguments: str


@dataclass(slots=True)
class StreamChunk:
    """One parsed upstream chunk."""

    content: str = ""
    tool_calls: list[ToolCallDelta] = field(default_factory=list)
    finish_reason: str | None = None


def resolve_api_key(settings: Settings) -> str | None:
    """Read the DeepSeek key from settings first, then the OS credential store."""
    if settings.deepseek_api_key:
        value = settings.deepseek_api_key.strip()
        return value or None
    try:
        keyring = importlib.import_module("keyring")
    except Exception:  # pragma: no cover - keyring 缺失时视为无 Key
        return None
    try:
        value = keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    except Exception:  # pragma: no cover - 凭据后端异常时不阻塞启动
        return None
    return str(value) if value else None


def ensure_model_ready(settings: Settings, api_key: str | None) -> None:
    """Gate every outbound call behind the explicit privacy switch."""
    if not settings.privacy_allow_external_calls:
        raise AppError(
            ErrorCode.MODEL_NOT_CONFIGURED,
            "尚未允许调用外部模型，请先在设置中开启并同意数据外发",
            http_status=409,
            details={"reason": "allow_external_calls"},
        )
    if not api_key:
        raise AppError(
            ErrorCode.MODEL_NOT_CONFIGURED,
            "尚未配置 DeepSeek API Key",
            http_status=409,
            details={"reason": "missing_api_key"},
        )


class DeepSeekClient:
    """Minimal streaming client for DeepSeek chat completions (+ tools)."""

    def __init__(
        self,
        settings: Settings,
        api_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self._api_key = api_key
        self._client = httpx.AsyncClient(
            base_url=MODEL_BASE_URL,
            transport=transport,
            timeout=httpx.Timeout(
                settings.llm_read_timeout_s, connect=settings.llm_connect_timeout_s
            ),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
        )

    async def aclose(self) -> None:
        """Release the underlying connection pool."""
        await self._client.aclose()

    async def astream(
        self, messages: Sequence[dict[str, Any]], *, tools: Sequence[dict[str, Any]] | None = None
    ) -> AsyncIterator[StreamChunk]:
        """Yield parsed chunks for one completion request."""
        payload: dict[str, Any] = {
            "model": self.settings.model_name,
            "messages": list(messages),
            "stream": True,
        }
        if tools:
            payload["tools"] = list(tools)
            payload["tool_choice"] = "auto"

        try:
            async with self._client.stream("POST", CHAT_PATH, json=payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise self._status_error(response.status_code, body)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data:
                        continue
                    if data == "[DONE]":
                        break
                    try:
                        parsed = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(parsed, dict):
                        continue
                    chunk = _parse_chunk(parsed)
                    if chunk is not None:
                        yield chunk
        except httpx.TimeoutException as exc:
            raise AppError(
                ErrorCode.MODEL_TIMEOUT, "模型响应超时，请稍后重试", http_status=504
            ) from exc
        except httpx.HTTPError as exc:
            raise AppError(
                ErrorCode.MODEL_CALL_FAILED,
                "模型调用失败",
                http_status=502,
                details={"reason": type(exc).__name__},
            ) from exc

    async def acomplete(
        self, messages: Sequence[dict[str, Any]], *, response_format_json: bool = False
    ) -> str:
        """One non-streaming completion; returns the assistant text."""
        payload: dict[str, Any] = {
            "model": self.settings.model_name,
            "messages": list(messages),
            "stream": False,
        }
        if response_format_json:
            payload["response_format"] = {"type": "json_object"}
        try:
            response = await self._client.post(CHAT_PATH, json=payload)
        except httpx.TimeoutException as exc:
            raise AppError(
                ErrorCode.MODEL_TIMEOUT, "模型响应超时，请稍后重试", http_status=504
            ) from exc
        except httpx.HTTPError as exc:
            raise AppError(
                ErrorCode.MODEL_CALL_FAILED,
                "模型调用失败",
                http_status=502,
                details={"reason": type(exc).__name__},
            ) from exc
        if response.status_code >= 400:
            raise self._status_error(response.status_code, response.text)
        try:
            body = response.json()
        except ValueError as exc:
            raise AppError(
                ErrorCode.MODEL_CALL_FAILED, "模型返回内容无法解析", http_status=502
            ) from exc
        choices = body.get("choices") if isinstance(body, dict) else None
        if not isinstance(choices, list) or not choices:
            raise AppError(ErrorCode.MODEL_CALL_FAILED, "模型未返回结果", http_status=502)
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        return str(content or "")

    def _status_error(self, status: int, body: str) -> AppError:
        lowered = body.lower()
        if "context" in lowered and ("length" in lowered or "maximum" in lowered):
            return AppError(
                ErrorCode.CONTEXT_TOO_LONG,
                "对话内容超出模型上下文长度，请精简后重试",
                http_status=422,
            )
        if "content" in lowered and ("filter" in lowered or "safety" in lowered):
            return AppError(ErrorCode.CONTENT_BLOCKED, "内容被上游安全策略拦截", http_status=422)
        logger.warning(
            "llm.upstream_error", extra={"fields": {"status": status, "body": body[:200]}}
        )
        return AppError(
            ErrorCode.MODEL_CALL_FAILED,
            "模型服务返回错误",
            http_status=502,
            details={"status": status},
        )


def _parse_chunk(payload: dict[str, Any]) -> StreamChunk | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    delta = first.get("delta")
    chunk = StreamChunk(finish_reason=first.get("finish_reason"))
    if isinstance(delta, dict):
        content = delta.get("content")
        if isinstance(content, str) and content:
            chunk.content = content
        raw_calls = delta.get("tool_calls")
        if isinstance(raw_calls, list):
            for position, raw in enumerate(raw_calls):
                if not isinstance(raw, dict):
                    continue
                function = raw.get("function")
                chunk.tool_calls.append(
                    ToolCallDelta(
                        index=int(raw.get("index", position) or 0),
                        call_id=str(raw.get("id") or ""),
                        name=str(function.get("name") or "") if isinstance(function, dict) else "",
                        arguments=str(function.get("arguments") or "")
                        if isinstance(function, dict)
                        else "",
                    )
                )
    if not chunk.content and not chunk.tool_calls and chunk.finish_reason is None:
        return None
    return chunk


def merge_tool_calls(deltas: Sequence[ToolCallDelta]) -> list[ToolCall]:
    """Aggregate streamed tool-call fragments into complete calls."""
    merged: dict[int, ToolCall] = {}
    for delta in deltas:
        current = merged.setdefault(delta.index, ToolCall(call_id="", name="", arguments=""))
        if delta.call_id:
            current.call_id = delta.call_id
        if delta.name:
            current.name += delta.name
        if delta.arguments:
            current.arguments += delta.arguments
    return [merged[index] for index in sorted(merged)]
