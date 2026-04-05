"""Crawl pipeline tracer — logs every step to JSONL for debugging.

Follows the same pattern as backend/agent/tracer.AgentTracer.
"""

from __future__ import annotations

import json
import logging
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

LOGS_DIR = Path("data/logs/crawl")


class CrawlTracer:
    """Logs every crawl pipeline step to a JSONL file per run."""

    def __init__(self, run_id: str) -> None:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        self._path = LOGS_DIR / f"{run_id}.jsonl"
        self._entries: list[dict] = []
        self._timers: dict[str, float] = {}

    def log(self, event: str, **data: object) -> None:
        """Append a timestamped log entry."""
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
            logger.debug("CrawlTracer write error: %s", exc)

    def start_timer(self, name: str) -> None:
        """Start a named timer."""
        self._timers[name] = time.time()

    def stop_timer(self, name: str) -> float:
        """Stop a named timer and return elapsed milliseconds."""
        t0 = self._timers.pop(name, None)
        if t0 is None:
            return 0.0
        return round((time.time() - t0) * 1000, 1)

    def log_step_start(self, step: str, **data: object) -> None:
        """Log the start of a pipeline step and start its timer."""
        self.start_timer(step)
        self.log("step_start", step=step, **data)

    def log_step_finish(self, step: str, ok: bool = True, **data: object) -> None:
        """Log the end of a pipeline step with elapsed time."""
        latency_ms = self.stop_timer(step)
        self.log("step_finish", step=step, ok=ok, latency_ms=latency_ms, **data)

    def log_error(self, step: str, exc: Exception) -> None:
        """Log an error with full traceback."""
        self.log("error", step=step, **format_error(exc))

    def get_entries(self) -> list[dict]:
        return list(self._entries)

    def get_summary(self) -> dict:
        """Build a summary of all step timings from logged entries."""
        steps: dict[str, dict] = {}
        for entry in self._entries:
            if entry["event"] == "step_finish":
                name = entry.get("step", "")
                steps[name] = {
                    "ok": entry.get("ok", True),
                    "latency_ms": entry.get("latency_ms", 0),
                }
        return steps

    @staticmethod
    def load(run_id: str) -> list[dict]:
        """Load log entries from file."""
        path = LOGS_DIR / f"{run_id}.jsonl"
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
    def list_runs() -> list[str]:
        """List all available run IDs."""
        if not LOGS_DIR.exists():
            return []
        return sorted(p.stem for p in LOGS_DIR.glob("*.jsonl"))


def format_error(exc: Exception) -> dict:
    """Format exception for logging."""
    return {
        "type": type(exc).__name__,
        "message": str(exc),
        "traceback": traceback.format_exc(),
    }
