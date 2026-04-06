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
    detailed_stats: dict | None = Field(
        default=None,
        description="Detailed simulation stats: card_performance, turn_momentum, action_patterns, game_summaries",
    )


# --- Aggregate Deck Health Analysis ---


class AggregateAnalysisRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


class CardHealthEntry(BaseModel):
    card_id: str
    card_name: str = ""
    times_played: int = 0
    play_rate: float = 0.0
    win_correlation: float = 0.0
    category: str = ""


class SynergyPair(BaseModel):
    card_a: str
    card_b: str
    co_occurrence_rate: float = 0.0
    win_lift: float = 0.0


class MatchupSpread(BaseModel):
    opponent: str
    win_rate: float
    num_games: int


class SwapCandidate(BaseModel):
    card_id: str
    name: str = ""
    image: str = ""
    power: int = 0
    cost: int = 0
    counter: int = 0
    synergy_count: int = 0


class ReplacementSuggestion(BaseModel):
    remove_id: str = ""
    remove_name: str = ""
    remove_image: str = ""
    role_needed: str = ""
    reason: str = ""
    candidates: list[SwapCandidate] = Field(default_factory=list)


class DeckHealthAnalysisResponse(BaseModel):
    summary: str
    consistency_rating: str = ""
    total_sims: int = 0
    total_games: int = 0
    overall_win_rate: float = 0.0
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    core_engine: list[CardHealthEntry] = Field(default_factory=list)
    dead_cards: list[CardHealthEntry] = Field(default_factory=list)
    role_gaps: list[str] = Field(default_factory=list)
    synergy_insights: list[str] = Field(default_factory=list)
    improvement_priorities: list[str] = Field(default_factory=list)
    card_health: list[CardHealthEntry] = Field(default_factory=list)
    top_synergies: list[SynergyPair] = Field(default_factory=list)
    matchup_spread: list[MatchupSpread] = Field(default_factory=list)
    suggested_swaps: list[ReplacementSuggestion] = Field(default_factory=list)
