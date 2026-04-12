"""Card repository — Neo4j data access for cards, synergies, search."""

from __future__ import annotations

from neo4j import AsyncDriver

from backend.graph.queries import (
    get_banned_cards,
    get_card_by_id,
    get_card_network,
    get_card_synergies,
    get_db_stats,
    get_deck_synergies,
    get_facets,
    search_cards,
)


class CardRepository:
    """Wraps Neo4j card queries with a class-based interface."""

    def __init__(self, driver: AsyncDriver):
        self.driver = driver

    async def get_by_id(self, card_id: str) -> dict | None:
        return await get_card_by_id(self.driver, card_id)

    async def get_batch(self, card_ids: list[str]) -> list[dict]:
        """Fetch multiple cards in a single Neo4j query (avoids N+1)."""
        if not card_ids:
            return []
        async with self.driver.session() as session:
            result = await session.run(
                """
                UNWIND $ids AS cid
                MATCH (c:Card {id: cid})
                OPTIONAL MATCH (c)-[:HAS_COLOR]->(color:Color)
                OPTIONAL MATCH (c)-[:BELONGS_TO]->(family:Family)
                OPTIONAL MATCH (c)-[:FROM_SET]->(s:Set)
                OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
                RETURN c,
                       collect(DISTINCT color.name) AS colors,
                       collect(DISTINCT family.name) AS families,
                       s.name AS set_name,
                       collect(DISTINCT kw.name) AS keywords
                """,
                ids=card_ids,
            )
            cards = []
            async for r in result:
                cards.append(
                    {
                        **dict(r["c"]),
                        "colors": r["colors"],
                        "families": r["families"],
                        "set_name": r["set_name"],
                        "keywords": r["keywords"],
                    }
                )
            return cards

    async def get_synergies(
        self,
        card_id: str,
        max_hops: int = 1,
        color_filter: str | None = None,
        include_mechanical: bool = False,
    ) -> list[dict]:
        return await get_card_synergies(
            self.driver, card_id, max_hops, color_filter, include_mechanical
        )

    async def get_network(self, card_id: str, hops: int = 2) -> dict:
        return await get_card_network(self.driver, card_id, hops)

    async def search(
        self,
        keyword: str | None = None,
        cost_min: int | None = None,
        cost_max: int | None = None,
        color: str | None = None,
        card_type: str | None = None,
        family: str | None = None,
        set_name: str | None = None,
        rarity: str | None = None,
        sort_by: str = "name",
        sort_order: str = "asc",
        offset: int = 0,
        limit: int = 25,
    ) -> dict:
        return await search_cards(
            self.driver,
            keyword=keyword,
            cost_min=cost_min,
            cost_max=cost_max,
            color=color,
            card_type=card_type,
            family=family,
            set_name=set_name,
            rarity=rarity,
            sort_by=sort_by,
            sort_order=sort_order,
            offset=offset,
            limit=limit,
        )

    async def get_deck_synergies(self, card_ids: list[str]) -> dict:
        return await get_deck_synergies(self.driver, card_ids)

    async def get_facets(self) -> dict:
        return await get_facets(self.driver)

    async def get_stats(self) -> dict:
        return await get_db_stats(self.driver)

    async def get_banned(self) -> list[dict]:
        return await get_banned_cards(self.driver)
