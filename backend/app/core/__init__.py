"""Core building blocks: config, errors, logging, security, paths, ids."""

from .config import APP_NAME, APP_VERSION, Settings, get_settings
from .errors import AppError, ErrorCode

__all__ = ["APP_NAME", "APP_VERSION", "AppError", "ErrorCode", "Settings", "get_settings"]
