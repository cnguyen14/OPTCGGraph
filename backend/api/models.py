"""Pydantic request/response models for the API."""

from pydantic import BaseModel, Field


class CardResponse(BaseModel):
    id: str
    code: str = ""
    name: str = ""
    card_type: str = ""
    cost: int | None = None
    power: int | None = None
    counter: int | None = None
    rarity: str = ""
    attribute: str = ""
    color: str = ""
    ability: str = ""
    trigger_effect: str = ""
    image_small: str = ""
    image_large: str = ""
    inventory_price: float | None = None
    market_price: float | None = None
    life: str = ""
    colors: list[str] = Field(default_factory=list)
    families: list[str] = Field(default_factory=list)
    set_name: str = ""
    keywords: list[str] = Field(default_factory=list)
    banned: bool = False
    ban_reason: str = ""


class SynergyPartner(BaseModel):
    id: str
    name: str = ""
    card_type: str = ""
    cost: int | None = None
    power: int | None = None
    color: str = ""
    image_small: str = ""


class SynergyResponse(BaseModel):
    card_id: str
    partners: list[SynergyPartner]
    total: int


class NetworkNode(BaseModel):
    id: str | None = None
    name: str | None = None
    labels: list[str] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict)


class NetworkEdge(BaseModel):
    type: str = ""
    start: str = ""
    end: str = ""
    properties: dict = Field(default_factory=dict)


class NetworkResponse(BaseModel):
    nodes: list[dict]
    edges: list[dict]


class CurveEntry(BaseModel):
    cost: int
    count: int
    cards: list[str]


class CurveResponse(BaseModel):
    curve: list[CurveEntry]
    total: int


class HubCard(BaseModel):
    id: str
    name: str = ""
    degree: int = 0


class SearchParams(BaseModel):
    keyword: str | None = None
    cost_max: int | None = None
    color: str | None = None
    card_type: str | None = None
    family: str | None = None
    limit: int = 25


class SearchResponse(BaseModel):
    cards: list[CardResponse] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 25


class SetFacet(BaseModel):
    id: str
    name: str


class FacetsResponse(BaseModel):
    colors: list[str] = Field(default_factory=list)
    card_types: list[str] = Field(default_factory=list)
    families: list[str] = Field(default_factory=list)
    sets: list[SetFacet] = Field(default_factory=list)
    rarities: list[str] = Field(default_factory=list)


class StatsResponse(BaseModel):
    cards: int = 0
    colors: int = 0
    families: int = 0
    sets: int = 0
    keywords: int = 0
    synergy_edges: int = 0
    mech_synergy_edges: int = 0
    curves_into_edges: int = 0
    banned_cards: int = 0


class DeckSynergyEdge(BaseModel):
    source: str
    target: str
    type: str
    weight: int | None = None
    shared_families: list[str] | None = None
    shared_keywords: list[str] | None = None
    cost_diff: int | None = None


class DeckSynergyRequest(BaseModel):
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


class DeckSynergyResponse(BaseModel):
    edges: list[DeckSynergyEdge] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    leader_id: str | None = None
    deck_card_ids: list[str] | None = None


class ModelSwitchRequest(BaseModel):
    provider: str  # "claude" or "openrouter"
    model: str


# === Meta / Tournament models ===


class TournamentResponse(BaseModel):
    id: str
    name: str = ""
    date: str = ""
    format: str = ""
    player_count: int = 0


class MetaDeckCard(BaseModel):
    id: str
    name: str = ""
    card_type: str = ""
    cost: int | None = None
    power: int | None = None
    counter: int | None = None
    count: int = 1
    image_small: str = ""
    keywords: list[str] = Field(default_factory=list)


class MetaDeckSummary(BaseModel):
    id: str
    leader_id: str = ""
    leader_name: str = ""
    archetype: str = ""
    placement: int | None = None
    player_name: str = ""
    tournament: TournamentResponse | None = None


class MetaDeckDetail(MetaDeckSummary):
    cards: list[MetaDeckCard] = Field(default_factory=list)
    total_cards: int = 0
    type_distribution: dict[str, int] = Field(default_factory=dict)
    leader_image: str = ""


class MetaOverviewArchetype(BaseModel):
    archetype: str
    count: int
    share: float  # 0-1


class MetaOverviewResponse(BaseModel):
    total_decks: int = 0
    total_tournaments: int = 0
    top_archetypes: list[MetaOverviewArchetype] = Field(default_factory=list)
    top_leaders: list[dict] = Field(default_factory=list)


class LeaderMetaResponse(BaseModel):
    leader_id: str
    leader_name: str = ""
    total_decks: int = 0
    avg_placement: float | None = None
    top_cut_count: int = 0
    top_archetypes: list[str] = Field(default_factory=list)
    popular_cards: list[MetaDeckCard] = Field(default_factory=list)


class SwapRequest(BaseModel):
    deck_card_ids: list[str]
    incoming_card_id: str
    leader_id: str | None = None


class SwapSuggestion(BaseModel):
    remove_id: str
    remove_name: str = ""
    add_id: str
    add_name: str = ""
    reason: str = ""


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
