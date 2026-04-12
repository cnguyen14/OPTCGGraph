"""AI agent Pydantic schemas."""

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    leader_id: str | None = None
    deck_card_ids: list[str] | None = None
    no_synergy_card_ids: list[str] | None = None


class ModelSwitchRequest(BaseModel):
    provider: str  # "claude" or "openrouter"
    model: str
