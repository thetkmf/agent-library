"""Run the backend with settings-driven host/port (loopback is enforced)."""

from __future__ import annotations

from .main import run


def main() -> None:
    """Start the local backend using the resolved settings."""
    run()


if __name__ == "__main__":
    main()
