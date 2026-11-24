"""Shared envelope, pagination and error models exposed through OpenAPI."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Envelope(BaseModel, Generic[T]):
    """Success envelope returned by every business endpoint."""

    code: int = 0
    message: str = "ok"
    data: T | None = None
    request_id: str


class ErrorEnvelope(BaseModel):
    """Failure envelope returned by the global exception handlers."""

    code: int
    message: str
    data: None = None
    request_id: str
    details: dict[str, Any] | None = None


class Page(BaseModel, Generic[T]):
    """Paginated collection payload used inside the envelope."""

    items: list[T] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_more: bool = False
