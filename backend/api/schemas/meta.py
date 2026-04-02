"""Meta/tournament Pydantic schemas."""

from pydantic import BaseModel, Field


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
    share: float


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
