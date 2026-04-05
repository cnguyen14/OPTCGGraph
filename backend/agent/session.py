"""Session memory management — Redis-persisted conversation history and deck state."""

import json
import uuid
import logging
from datetime import datetime

from backend.storage.redis_client import get_redis

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 7 * 86400  # 7 days
MAX_HISTORY_MESSAGES = 100  # Prevent context overflow
_KEY_PREFIX = "chat:session:"
_CLIENT_PREFIX = "chat:client:"

# In-memory cache (fast reads, Redis is source of truth)
_sessions: dict[str, dict] = {}


def _default_session_data() -> dict:
    now = datetime.now().isoformat()
    return {
        "messages": [],
        "current_deck": {"leader": None, "cards": [], "total_cost": 0},
        "selected_leader": None,
        "model_config": {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
        "title": "",
        "client_id": "",
        "created_at": now,
        "updated_at": now,
    }


class Session:
    """Manages conversation state for a user session."""

    def __init__(self, session_id: str | None = None):
        self.id = session_id or str(uuid.uuid4())
        self._ensure_exists()

    def _ensure_exists(self):
        if self.id not in _sessions:
            _sessions[self.id] = _default_session_data()

    def get_messages(self) -> list[dict]:
        return _sessions[self.id]["messages"]

    def save_messages(self, messages: list[dict]):
        # Truncate oldest messages to prevent context overflow
        if len(messages) > MAX_HISTORY_MESSAGES:
            messages = messages[-MAX_HISTORY_MESSAGES:]
        _sessions[self.id]["messages"] = messages
        _sessions[self.id]["updated_at"] = datetime.now().isoformat()
        # Auto-set title from first user message
        if not _sessions[self.id].get("title"):
            for m in messages:
                if m.get("role") == "user" and isinstance(m.get("content"), str):
                    _sessions[self.id]["title"] = m["content"][:60]
                    break

    @property
    def current_deck(self) -> dict:
        return _sessions[self.id]["current_deck"]

    @current_deck.setter
    def current_deck(self, deck: dict):
        _sessions[self.id]["current_deck"] = deck

    @property
    def selected_leader(self) -> str | None:
        return _sessions[self.id]["selected_leader"]

    @selected_leader.setter
    def selected_leader(self, leader_id: str | None):
        _sessions[self.id]["selected_leader"] = leader_id

    @property
    def model_config(self) -> dict:
        return _sessions[self.id]["model_config"]

    @model_config.setter
    def model_config(self, config: dict):
        _sessions[self.id]["model_config"] = config

    @property
    def client_id(self) -> str:
        return _sessions[self.id].get("client_id", "")

    @client_id.setter
    def client_id(self, cid: str):
        _sessions[self.id]["client_id"] = cid

    @property
    def title(self) -> str:
        return _sessions[self.id].get("title", "")

    def to_dict(self) -> dict:
        return {**_sessions[self.id], "session_id": self.id}

    # --- Redis persistence ---

    async def persist(self) -> None:
        """Save session to Redis."""
        try:
            r = await get_redis()
            key = f"{_KEY_PREFIX}{self.id}"
            data = json.dumps(_sessions[self.id], default=str)
            await r.set(key, data, ex=SESSION_TTL_SECONDS)

            # Update client session index
            cid = _sessions[self.id].get("client_id")
            if cid:
                ts = datetime.now().timestamp()
                idx_key = f"{_CLIENT_PREFIX}{cid}:sessions"
                await r.zadd(idx_key, {self.id: ts})
                await r.expire(idx_key, SESSION_TTL_SECONDS)
        except Exception:
            logger.warning(
                "Failed to persist session %s to Redis", self.id, exc_info=True
            )

    @classmethod
    async def load_from_redis(cls, session_id: str) -> "Session | None":
        """Load a session from Redis into memory cache."""
        try:
            r = await get_redis()
            raw = await r.get(f"{_KEY_PREFIX}{session_id}")
            if not raw:
                return None
            data = json.loads(raw)
            _sessions[session_id] = data
            s = cls.__new__(cls)
            s.id = session_id
            return s
        except Exception:
            logger.warning(
                "Failed to load session %s from Redis", session_id, exc_info=True
            )
            return None

    @staticmethod
    async def list_sessions(client_id: str, limit: int = 50) -> list[dict]:
        """List session summaries for a client, most recent first."""
        try:
            r = await get_redis()
            idx_key = f"{_CLIENT_PREFIX}{client_id}:sessions"
            # Get session IDs ordered by score (timestamp) descending
            session_ids = await r.zrevrange(idx_key, 0, limit - 1)
            if not session_ids:
                return []

            summaries = []
            for sid in session_ids:
                raw = await r.get(f"{_KEY_PREFIX}{sid}")
                if not raw:
                    # Stale index entry — remove it
                    await r.zrem(idx_key, sid)
                    continue
                data = json.loads(raw)
                msgs = data.get("messages", [])
                msg_count = sum(1 for m in msgs if isinstance(m.get("content"), str))
                summaries.append(
                    {
                        "session_id": sid,
                        "title": data.get("title", "Untitled"),
                        "created_at": data.get("created_at"),
                        "updated_at": data.get("updated_at"),
                        "message_count": msg_count,
                    }
                )
            return summaries
        except Exception:
            logger.warning(
                "Failed to list sessions for client %s", client_id, exc_info=True
            )
            return []

    @staticmethod
    async def delete_session(session_id: str, client_id: str | None = None) -> bool:
        """Delete a session from Redis and memory."""
        try:
            r = await get_redis()
            await r.delete(f"{_KEY_PREFIX}{session_id}")
            if client_id:
                await r.zrem(f"{_CLIENT_PREFIX}{client_id}:sessions", session_id)
            _sessions.pop(session_id, None)
            return True
        except Exception:
            logger.warning("Failed to delete session %s", session_id, exc_info=True)
            return False
