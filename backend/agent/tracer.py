"""Agent tracer — logs every AI agent decision to JSONL for debugging."""

from __future__ import annotations

import json
import logging
import traceback
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

LOGS_DIR = Path("data/logs/agent")


class AgentTracer:
    """Logs every AI agent interaction to a JSONL file per session."""

    def __init__(self, session_id: str) -> None:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        self._path = LOGS_DIR / f"{session_id}.jsonl"
        self._entries: list[dict] = []

    def log(self, event: str, **data: object) -> None:
        """Append a log entry."""
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **data,
        }
        self._entries.append(record)
        try:
            with self._path.open("a") as f:
                f.write(json.dumps(record, default=str) + "\n")
        except Exception as exc:
            logger.debug("AgentTracer write error: %s", exc)

    def get_entries(self) -> list[dict]:
        return self._entries

    @staticmethod
    def load(session_id: str) -> list[dict]:
        """Load log entries from file."""
        path = LOGS_DIR / f"{session_id}.jsonl"
        if not path.exists():
            return []
        entries = []
        for line in path.read_text().strip().split("\n"):
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return entries

    @staticmethod
    def format_error(exc: Exception) -> dict:
        """Format exception for logging."""
        return {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
