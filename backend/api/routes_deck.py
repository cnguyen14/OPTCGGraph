"""Deck validation API endpoint."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from neo4j import AsyncDriver

from backend.graph.connection import get_driver
from backend.graph.queries import get_card_by_id
from backend.ai.deck_validator import validate_deck

router = APIRouter(prefix="/api/deck", tags=["deck"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


class DeckValidateRequest(BaseModel):
    leader_id: str
    card_ids: list[str] = Field(..., min_length=1, max_length=60)


@router.post("/validate")
async def validate(req: DeckValidateRequest, driver: AsyncDriver = Depends(_get_driver)):
    """Validate a deck against official OPTCG rules and competitive quality standards.

    Returns a detailed report with PASS/FAIL/WARNING for each check.
    """
    # Fetch leader
    leader = await get_card_by_id(driver, req.leader_id)
    if leader is None:
        raise HTTPException(status_code=404, detail=f"Leader {req.leader_id} not found")

    # Fetch all cards
    cards = []
    missing = []
    for card_id in req.card_ids:
        card = await get_card_by_id(driver, card_id)
        if card is None:
            missing.append(card_id)
        else:
            cards.append(card)

    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Cards not found: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}",
        )

    report = validate_deck(leader, cards)
    return report.to_dict()
