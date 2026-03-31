"""Deck validation and saved deck management API endpoints."""

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from neo4j import AsyncDriver

from backend.graph.connection import get_driver
from backend.graph.queries import get_card_by_id
from backend.ai.deck_validator import validate_deck
from backend.ai.deck_suggestions import suggest_fixes
from backend.storage.redis_client import get_redis
from backend.api.models import (
    SaveDeckRequest,
    SavedDeckResponse,
    SavedDeckListItem,
)

router = APIRouter(prefix="/api/deck", tags=["deck"])

DECK_TTL_SECONDS = 90 * 24 * 3600  # 90 days
MAX_SAVED_DECKS = 50


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


@router.post("/suggest-fixes")
async def suggest(req: DeckValidateRequest, driver: AsyncDriver = Depends(_get_driver)):
    """Generate smart replacement suggestions for deck validation issues.

    Returns suggestions ranked by priority (rule fixes first, then quality improvements).
    Each suggestion includes a card to remove, a card to add, and reasoning.
    """
    return await suggest_fixes(driver, req.leader_id, req.card_ids)


# --- Saved Decks (Redis) ---


async def _get_client_id(x_client_id: str = Header(...)) -> str:
    if not x_client_id or len(x_client_id) > 64:
        raise HTTPException(400, "Invalid X-Client-Id header")
    return x_client_id


def _deck_key(client_id: str, deck_id: str) -> str:
    return f"deck:{client_id}:{deck_id}"


def _index_key(client_id: str) -> str:
    return f"deck-index:{client_id}"


@router.post("/saved", response_model=SavedDeckResponse)
async def save_deck(
    req: SaveDeckRequest,
    deck_id: str | None = Query(None, alias="id"),
    client_id: str = Depends(_get_client_id),
):
    """Save a new deck or update an existing one."""
    r = await get_redis()
    index_key = _index_key(client_id)

    if deck_id:
        # Update existing
        key = _deck_key(client_id, deck_id)
        existing = await r.get(key)
        if not existing:
            raise HTTPException(404, "Deck not found")
        old = json.loads(existing)
        created_at = old.get("created_at", datetime.now(timezone.utc).isoformat())
    else:
        # Create new — check limit
        count = await r.scard(index_key)
        if count >= MAX_SAVED_DECKS:
            raise HTTPException(400, f"Maximum {MAX_SAVED_DECKS} saved decks reached")
        deck_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

    now = datetime.now(timezone.utc).isoformat()
    deck_data = {
        "id": deck_id,
        "name": req.name,
        "description": req.description,
        "leader_id": req.leader_id,
        "entries": [e.model_dump() for e in req.entries],
        "deck_notes": req.deck_notes,
        "created_at": created_at,
        "updated_at": now,
    }

    key = _deck_key(client_id, deck_id)
    await r.set(key, json.dumps(deck_data), ex=DECK_TTL_SECONDS)
    await r.sadd(index_key, deck_id)
    await r.expire(index_key, DECK_TTL_SECONDS)

    return SavedDeckResponse(**deck_data)


@router.get("/saved", response_model=list[SavedDeckListItem])
async def list_saved_decks(client_id: str = Depends(_get_client_id)):
    """List all saved decks for this client."""
    r = await get_redis()
    index_key = _index_key(client_id)
    deck_ids = await r.smembers(index_key)

    if not deck_ids:
        return []

    # Batch fetch with pipeline
    pipe = r.pipeline()
    for did in deck_ids:
        pipe.get(_deck_key(client_id, did))
    results = await pipe.execute()

    decks: list[SavedDeckListItem] = []
    stale_ids: list[str] = []

    for did, raw in zip(deck_ids, results):
        if raw is None:
            stale_ids.append(did)
            continue
        data = json.loads(raw)
        card_count = sum(e["quantity"] for e in data.get("entries", []))
        decks.append(SavedDeckListItem(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            leader_id=data.get("leader_id"),
            card_count=card_count,
            created_at=data["created_at"],
            updated_at=data["updated_at"],
        ))

    # Cleanup stale index entries
    if stale_ids:
        await r.srem(index_key, *stale_ids)

    # Sort by updated_at descending
    decks.sort(key=lambda d: d.updated_at, reverse=True)
    return decks


@router.get("/saved/{deck_id}", response_model=SavedDeckResponse)
async def get_saved_deck(
    deck_id: str,
    client_id: str = Depends(_get_client_id),
):
    """Load a saved deck."""
    r = await get_redis()
    key = _deck_key(client_id, deck_id)
    raw = await r.get(key)

    if raw is None:
        raise HTTPException(404, "Deck not found")

    # Refresh TTL on access
    await r.expire(key, DECK_TTL_SECONDS)

    data = json.loads(raw)
    return SavedDeckResponse(**data)


@router.delete("/saved/{deck_id}")
async def delete_saved_deck(
    deck_id: str,
    client_id: str = Depends(_get_client_id),
):
    """Delete a saved deck."""
    r = await get_redis()
    key = _deck_key(client_id, deck_id)

    deleted = await r.delete(key)
    if not deleted:
        raise HTTPException(404, "Deck not found")

    await r.srem(_index_key(client_id), deck_id)
    return {"ok": True}
