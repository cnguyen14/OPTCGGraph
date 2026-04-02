"""Card-related Pydantic schemas."""

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


class CurveEntry(BaseModel):
    cost: int
    count: int
    cards: list[str]


class CurveResponse(BaseModel):
    curve: list[CurveEntry]
    total: int
