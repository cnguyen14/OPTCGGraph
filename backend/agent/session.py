"""Session memory management — stores conversation history and deck state."""

import uuid
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# In-memory session store (will be replaced with Redis in production)
_sessions: dict[str, dict] = {}

SESSION_TTL_HOURS = 24


class Session:
    """Manages conversation state for a user session."""

    def __init__(self, session_id: str | None = None):
        self.id = session_id or str(uuid.uuid4())
        self._ensure_exists()

    def _ensure_exists(self):
        if self.id not in _sessions:
            _sessions[self.id] = {
                "messages": [],
                "current_deck": {"leader": None, "cards": [], "total_cost": 0},
                "selected_leader": None,
                "model_config": {"provider": "claude", "model": "claude-sonnet-4-20250514"},
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            }

    def get_messages(self) -> list[dict]:
        return _sessions[self.id]["messages"]

    def save_messages(self, messages: list[dict]):
        _sessions[self.id]["messages"] = messages
        _sessions[self.id]["updated_at"] = datetime.now().isoformat()

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

    def to_dict(self) -> dict:
        return {**_sessions[self.id], "session_id": self.id}
