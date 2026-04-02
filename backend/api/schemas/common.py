"""Common/shared Pydantic schemas."""

from pydantic import BaseModel, Field


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
