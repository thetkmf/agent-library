"""Run the backend with settings-driven host/port (loopback is enforced)."""

from __future__ import annotations

import uvicorn

from .core.config import get_settings
from .core.logging import configure_logging
from .main import create_app


def main() -> None:
    """Start the local backend using the resolved settings."""
    settings = get_settings()
    configure_logging(settings.log_level)
    app = create_app(settings)
    uvicorn.run(app, host=settings.host, port=settings.port, log_config=None, access_log=False)


if __name__ == "__main__":
    main()
