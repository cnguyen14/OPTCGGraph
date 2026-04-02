"""Graph service — card lookup, synergy discovery, search."""

from __future__ import annotations

from backend.core.exceptions import CardNotFoundError
from backend.repositories.card_repository import CardRepository


class GraphService:
    """Business logic for card and graph operations."""

    def __init__(self, card_repo: CardRepository):
        self.card_repo = card_repo

    async def get_card_detail(self, card_id: str) -> dict:
        card = await self.card_repo.get_by_id(card_id)
        if card is None:
            raise CardNotFoundError(card_id)
        return card

    async def get_synergies(
        self,
        card_id: str,
        max_hops: int = 1,
        color_filter: str | None = None,
        include_mechanical: bool = False,
    ) -> list[dict]:
        return await self.card_repo.get_synergies(
            card_id, max_hops, color_filter, include_mechanical
        )

    async def get_network(self, card_id: str, hops: int = 2) -> dict:
        return await self.card_repo.get_network(card_id, hops)

    async def search(self, **params) -> dict:
        return await self.card_repo.search(**params)

    async def get_deck_synergies(self, card_ids: list[str]) -> dict:
        return await self.card_repo.get_deck_synergies(card_ids)

    async def get_facets(self) -> dict:
        return await self.card_repo.get_facets()

    async def get_stats(self) -> dict:
        return await self.card_repo.get_stats()
