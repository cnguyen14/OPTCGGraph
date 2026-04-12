"""Deck repository — Redis CRUD for saved decks and simulation history."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

DECK_TTL_SECONDS = 90 * 86400  # 90 days
MAX_SAVED_DECKS = 50


def _deck_key(client_id: str, deck_id: str) -> str:
    return f"deck:{client_id}:{deck_id}"


def _index_key(client_id: str) -> str:
    return f"deck-index:{client_id}"


class DeckRepository:
    """Redis-backed storage for saved decks."""

    def __init__(self, redis):  # type: ignore[no-untyped-def]
        self.redis = redis

    async def save(
        self,
        client_id: str,
        deck_data: dict,
        deck_id: str | None = None,
    ) -> dict:
        """Save a new deck or update an existing one. Returns saved data."""
        index_key = _index_key(client_id)

        if deck_id:
            key = _deck_key(client_id, deck_id)
            existing = await self.redis.get(key)
            if not existing:
                return {"error": "Deck not found"}
            old = json.loads(existing)
            created_at = old.get("created_at", datetime.now(timezone.utc).isoformat())
        else:
            count = await self.redis.scard(index_key)
            if count >= MAX_SAVED_DECKS:
                return {"error": f"Maximum {MAX_SAVED_DECKS} saved decks reached"}
            deck_id = str(uuid.uuid4())
            created_at = datetime.now(timezone.utc).isoformat()

        now = datetime.now(timezone.utc).isoformat()
        full_data = {
            **deck_data,
            "id": deck_id,
            "created_at": created_at,
            "updated_at": now,
        }

        key = _deck_key(client_id, deck_id)
        await self.redis.set(key, json.dumps(full_data), ex=DECK_TTL_SECONDS)
        await self.redis.sadd(index_key, deck_id)
        await self.redis.expire(index_key, DECK_TTL_SECONDS)

        return full_data

    async def list_by_client(self, client_id: str) -> list[dict]:
        """List all saved decks for a client, sorted by updated_at desc."""
        index_key = _index_key(client_id)
        deck_ids = await self.redis.smembers(index_key)

        if not deck_ids:
            return []

        pipe = self.redis.pipeline()
        for did in deck_ids:
            pipe.get(_deck_key(client_id, did))
        results = await pipe.execute()

        decks: list[dict] = []
        stale_ids: list[str] = []

        for did, raw in zip(deck_ids, results):
            if raw is None:
                stale_ids.append(did)
                continue
            decks.append(json.loads(raw))

        if stale_ids:
            await self.redis.srem(index_key, *stale_ids)

        decks.sort(key=lambda d: d.get("updated_at", ""), reverse=True)
        return decks

    async def get(self, client_id: str, deck_id: str) -> dict | None:
        """Load a single saved deck. Refreshes TTL on access."""
        key = _deck_key(client_id, deck_id)
        raw = await self.redis.get(key)
        if raw is None:
            return None
        await self.redis.expire(key, DECK_TTL_SECONDS)
        return json.loads(raw)

    async def delete(self, client_id: str, deck_id: str) -> bool:
        """Delete a saved deck. Returns True if deleted."""
        key = _deck_key(client_id, deck_id)
        deleted = await self.redis.delete(key)
        if deleted:
            await self.redis.srem(_index_key(client_id), deck_id)
        return bool(deleted)
