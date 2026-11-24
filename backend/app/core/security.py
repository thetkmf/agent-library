"""Local bearer token verification."""

from __future__ import annotations

import hashlib
import hmac

from .config import Settings
from .errors import AppError, ErrorCode


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


def token_fingerprint(token: str) -> str:
    """Return a short non-reversible fingerprint usable in logs."""
    return _digest(token).hex()[:12]


def verify_bearer(authorization: str | None, settings: Settings) -> None:
    """Validate an Authorization header against the configured local token."""
    if not authorization:
        raise AppError(ErrorCode.UNAUTHENTICATED, "缺少访问令牌")
    scheme, _, credentials = authorization.partition(" ")
    token = credentials.strip()
    if scheme.lower() != "bearer" or not token:
        raise AppError(ErrorCode.UNAUTHENTICATED, "访问令牌格式错误")
    expected = settings.token
    if expected is None:
        raise AppError(ErrorCode.SERVICE_NOT_READY, "本地令牌未配置，服务未就绪")
    if not hmac.compare_digest(_digest(token), _digest(expected)):
        raise AppError(ErrorCode.UNAUTHENTICATED, "访问令牌无效")
