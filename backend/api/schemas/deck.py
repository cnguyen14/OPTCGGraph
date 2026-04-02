"""Deck-related Pydantic schemas."""

from pydantic import BaseModel, Field


# --- Saved Decks ---


class DeckEntryPayload(BaseModel):
    card_id: str
    quantity: int = Field(..., ge=1, le=4)


class SaveDeckRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    leader_id: str | None = None
    entries: list[DeckEntryPayload] = Field(default_factory=list)
    deck_notes: str = ""


class SavedDeckResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    leader_id: str | None = None
    entries: list[DeckEntryPayload] = Field(default_factory=list)
    deck_notes: str = ""
    created_at: str
    updated_at: str


class SavedDeckListItem(BaseModel):
    id: str
    name: str
    description: str = ""
    leader_id: str | None = None
    card_count: int = 0
    created_at: str
    updated_at: str


class DeckValidateRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


# --- Deck Analysis ---


class DeckAnalyzeRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


class ValidationSummary(BaseModel):
    checks: list[dict] = Field(default_factory=list)
    pass_count: int = 0
    fail_count: int = 0
    warning_count: int = 0


class DeckAnalyzeResponse(BaseModel):
    validation: ValidationSummary
    playstyle: str = "midrange"
    synergy_score: int = 0
    suggestions: list[dict] = Field(default_factory=list)
    card_roles: dict[str, int] = Field(default_factory=dict)
    cost_curve: dict[str, int] = Field(default_factory=dict)


# --- Simulation History ---


class SimHistoryRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


class SimHistoryEntry(BaseModel):
    sim_id: str = ""
    opponent_leader: str = ""
    win_rate: float = 0.0
    num_games: int = 0
    avg_turns: float = 0.0
    mode: str = "virtual"
    model: str = ""
    timestamp: str = ""


class SimHistoryResponse(BaseModel):
    simulations: list[SimHistoryEntry] = Field(default_factory=list)


# --- Deck Improve ---


class CardSimStats(BaseModel):
    times_played: int = 0
    times_in_winning_game: int = 0
    win_correlation: float = 0.0


class DeckImproveRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)
    sim_card_stats: dict[str, CardSimStats] | None = None


class ImprovementCard(BaseModel):
    card_id: str
    card_name: str = ""
    reason: str = ""


class Improvement(BaseModel):
    action: str = "swap"
    remove: ImprovementCard
    add: ImprovementCard
    impact: str = "medium"


class DeckImproveResponse(BaseModel):
    improvements: list[Improvement] = Field(default_factory=list)
    summary: str = ""


# --- Matchup Analysis ---


class MatchupAnalysisRequest(BaseModel):
    leader_id: str
    card_ids: list[str]
    sim_id: str


class MatchupAnalysisResponse(BaseModel):
    analysis: str
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    overperformers: list[dict] = Field(default_factory=list)
    underperformers: list[dict] = Field(default_factory=list)
    suggested_swaps: list[dict] = Field(default_factory=list)
