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


class StatsResponse(BaseModel):
    cards: int = 0
    colors: int = 0
    families: int = 0
    sets: int = 0
    keywords: int = 0


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    leader_id: str | None = None


class ModelSwitchRequest(BaseModel):
    provider: str  # "claude" or "openrouter"
    model: str
