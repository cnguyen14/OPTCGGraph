"""Meta service — tournament meta analysis and swap suggestions."""

from __future__ import annotations

from backend.repositories.meta_repository import MetaRepository


class MetaService:
    """Business logic for tournament meta analysis."""

    def __init__(self, meta_repo: MetaRepository):
        self.meta_repo = meta_repo

    async def get_overview(self) -> dict:
        return await self.meta_repo.get_overview()

    async def get_leader_meta(self, leader_id: str) -> dict:
        return await self.meta_repo.get_leader_meta(leader_id)

    async def list_tournaments(self, limit: int = 50) -> list[dict]:
        return await self.meta_repo.list_tournaments(limit)

    async def list_decks(self, **filters) -> list[dict]:
        return await self.meta_repo.list_decks(**filters)

    async def get_deck_detail(self, deck_id: str) -> dict | None:
        return await self.meta_repo.get_deck_detail(deck_id)
