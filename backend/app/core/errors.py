"""Registered error codes, the AppError type and envelope-based handlers."""

from __future__ import annotations

import logging
from enum import IntEnum
from typing import Any, Final, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .envelope import error_envelope

logger = logging.getLogger("pkb.errors")


class ErrorCode(IntEnum):
    """Error codes registered in docs/开发接口标准.md section 3.3."""

    OK = 0
    UNKNOWN = 10001
    SERVICE_NOT_READY = 10002
    RATE_LIMITED = 10003
    BODY_TOO_LARGE = 10004
    UNAUTHENTICATED = 20001
    TOKEN_INVALID = 20002
    FORBIDDEN = 20003
    NOT_FOUND = 30001
    ALREADY_EXISTS = 30002
    VERSION_CONFLICT = 30003
    GONE = 30004
    VALIDATION_FAILED = 40001
    UNSUPPORTED_QUERY = 40002
    UNSUPPORTED_FILE_TYPE = 40003
    FILE_TOO_LARGE = 40004
    UPLOAD_INCOMPLETE = 40005
    MODEL_NOT_CONFIGURED = 50001
    MODEL_CALL_FAILED = 50002
    MODEL_TIMEOUT = 50003
    CONTEXT_TOO_LONG = 50004
    CONTENT_BLOCKED = 50005
    EMBEDDING_FAILED = 50006
    STORAGE_WRITE_FAILED = 60001
    STORAGE_FULL = 60002
    ILLEGAL_PATH = 60003


HTTP_STATUS_BY_CODE: Final[dict[ErrorCode, int]] = {
    ErrorCode.OK: 200,
    ErrorCode.UNKNOWN: 500,
    ErrorCode.SERVICE_NOT_READY: 503,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.BODY_TOO_LARGE: 413,
    ErrorCode.UNAUTHENTICATED: 401,
    ErrorCode.TOKEN_INVALID: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.ALREADY_EXISTS: 409,
    ErrorCode.VERSION_CONFLICT: 409,
    ErrorCode.GONE: 410,
    ErrorCode.VALIDATION_FAILED: 422,
    ErrorCode.UNSUPPORTED_QUERY: 400,
    ErrorCode.UNSUPPORTED_FILE_TYPE: 415,
    ErrorCode.FILE_TOO_LARGE: 413,
    ErrorCode.UPLOAD_INCOMPLETE: 400,
    ErrorCode.MODEL_NOT_CONFIGURED: 409,
    ErrorCode.MODEL_CALL_FAILED: 502,
    ErrorCode.MODEL_TIMEOUT: 504,
    ErrorCode.CONTEXT_TOO_LONG: 422,
    ErrorCode.CONTENT_BLOCKED: 422,
    ErrorCode.EMBEDDING_FAILED: 500,
    ErrorCode.STORAGE_WRITE_FAILED: 500,
    ErrorCode.STORAGE_FULL: 507,
    ErrorCode.ILLEGAL_PATH: 400,
}

# Reverse mapping for HTTP exceptions raised by the framework. Status codes without a
# registered code (e.g. 405) keep their HTTP status and degrade to 10001 until the
# contract registers a dedicated code.
_CODE_BY_HTTP_STATUS: Final[dict[int, ErrorCode]] = {
    400: ErrorCode.UNSUPPORTED_QUERY,
    401: ErrorCode.UNAUTHENTICATED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    409: ErrorCode.ALREADY_EXISTS,
    410: ErrorCode.GONE,
    413: ErrorCode.BODY_TOO_LARGE,
    415: ErrorCode.UNSUPPORTED_FILE_TYPE,
    422: ErrorCode.VALIDATION_FAILED,
    429: ErrorCode.RATE_LIMITED,
    503: ErrorCode.SERVICE_NOT_READY,
}

_DEFAULT_HTTP_MESSAGES: Final[dict[int, str]] = {
    400: "请求不合法",
    401: "未认证",
    403: "无权限",
    404: "资源不存在",
    405: "不支持的请求方法",
    429: "请求过于频繁",
    503: "服务未就绪",
}


class AppError(Exception):
    """Business exception carrying a registered error code."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        http_status: int | None = None,
        details: dict[str, Any] | None = None,
        data: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status if http_status is not None else HTTP_STATUS_BY_CODE[code]
        self.details = details
        self.data = data


def not_found(message: str = "资源不存在", *, details: dict[str, Any] | None = None) -> AppError:
    """Build a 30001 error."""
    return AppError(ErrorCode.NOT_FOUND, message, details=details)


def unauthorized(message: str = "未认证", *, details: dict[str, Any] | None = None) -> AppError:
    """Build a 20001 error."""
    return AppError(ErrorCode.UNAUTHENTICATED, message, details=details)


def validation_failed(
    message: str = "参数校验失败", *, details: dict[str, Any] | None = None
) -> AppError:
    """Build a 40001 error."""
    return AppError(ErrorCode.VALIDATION_FAILED, message, details=details)


def version_conflict(message: str = "版本冲突，请刷新后重试", *, data: Any = None) -> AppError:
    """Build a 30003 error carrying the server-side current resource in `data`."""
    return AppError(ErrorCode.VERSION_CONFLICT, message, data=data)


def already_exists(
    message: str = "资源已存在", *, details: dict[str, Any] | None = None
) -> AppError:
    """Build a 30002 error."""
    return AppError(ErrorCode.ALREADY_EXISTS, message, details=details)


def gone(message: str = "资源已删除") -> AppError:
    """Build a 30004 error."""
    return AppError(ErrorCode.GONE, message)


def unsupported_query(message: str = "不支持的排序或过滤") -> AppError:
    """Build a 40002 error."""
    return AppError(ErrorCode.UNSUPPORTED_QUERY, message)


def illegal_path(message: str = "路径非法") -> AppError:
    """Build a 60003 error."""
    return AppError(ErrorCode.ILLEGAL_PATH, message)


def service_not_ready(message: str = "服务未就绪") -> AppError:
    """Build a 10002 error."""
    return AppError(ErrorCode.SERVICE_NOT_READY, message)


def _log_failure(request: Request, code: ErrorCode, status: int) -> None:
    level = logging.ERROR if status >= 500 else logging.WARNING
    logger.log(
        level,
        "request.failed",
        extra={"fields": {"code": int(code), "status": status, "path": request.url.path}},
    )


async def _handle_app_error(request: Request, exc: Exception) -> JSONResponse:
    error = cast(AppError, exc)
    _log_failure(request, error.code, error.http_status)
    content = error_envelope(error.code, error.message, error.details, error.data)
    return JSONResponse(status_code=error.http_status, content=content)


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    validation_error = cast(RequestValidationError, exc)
    errors = [
        {
            "loc": [str(part) for part in item.get("loc", ())],
            "msg": str(item.get("msg", "")),
            "type": str(item.get("type", "")),
        }
        for item in validation_error.errors()[:10]
    ]
    message = "参数校验失败"
    if errors and errors[0]["loc"]:
        message = f"{message}：{errors[0]['loc'][-1]}"
    _log_failure(request, ErrorCode.VALIDATION_FAILED, 422)
    content = error_envelope(ErrorCode.VALIDATION_FAILED, message, {"errors": errors})
    return JSONResponse(status_code=422, content=content)


async def _handle_http_error(request: Request, exc: Exception) -> JSONResponse:
    http_error = cast(StarletteHTTPException, exc)
    code = _CODE_BY_HTTP_STATUS.get(http_error.status_code, ErrorCode.UNKNOWN)
    message = _DEFAULT_HTTP_MESSAGES.get(http_error.status_code, "请求失败")
    _log_failure(request, code, http_error.status_code)
    return JSONResponse(
        status_code=http_error.status_code,
        content=error_envelope(code, message),
    )


async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "request.crashed",
        exc_info=exc,
        extra={"fields": {"path": request.url.path}},
    )
    return JSONResponse(
        status_code=500,
        content=error_envelope(ErrorCode.UNKNOWN, "服务内部错误"),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Install the global exception handlers on the application."""
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_error)
    app.add_exception_handler(Exception, _handle_unexpected_error)
