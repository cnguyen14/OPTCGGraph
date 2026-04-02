"""Session repository — Redis-backed session persistence.

Replaces the in-memory _sessions dict in agent/session.py so sessions
survive process restarts.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 24 * 3600  # 24 hours
SESSION_PREFIX = "agent-session:"


class SessionRepository:
    """Redis-backed session storage."""

    def __init__(self, redis):  # type: ignore[no-untyped-def]
        self.redis = redis

    async def get(self, session_id: str) -> dict | None:
        """Load session data. Returns None if not found or expired."""
        raw = await self.redis.get(f"{SESSION_PREFIX}{session_id}")
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Corrupt session data for %s", session_id)
            return None

    async def save(self, session_id: str, data: dict) -> None:
        """Persist session data with TTL."""
        await self.redis.set(
            f"{SESSION_PREFIX}{session_id}",
            json.dumps(data, default=str),
            ex=SESSION_TTL_SECONDS,
        )

    async def delete(self, session_id: str) -> None:
        """Remove a session."""
        await self.redis.delete(f"{SESSION_PREFIX}{session_id}")

    async def refresh_ttl(self, session_id: str) -> None:
        """Extend session TTL without modifying data."""
        await self.redis.expire(f"{SESSION_PREFIX}{session_id}", SESSION_TTL_SECONDS)
