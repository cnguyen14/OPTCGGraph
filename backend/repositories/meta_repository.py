"""Meta repository — Neo4j data access for tournaments and meta stats."""

from __future__ import annotations

from neo4j import AsyncDriver


class MetaRepository:
    """Wraps Neo4j tournament/meta queries."""

    def __init__(self, driver: AsyncDriver):
        self.driver = driver

    async def list_tournaments(self, limit: int = 50) -> list[dict]:
        async with self.driver.session() as session:
            result = await session.run(
                """
                MATCH (t:Tournament)
                RETURN t
                ORDER BY t.player_count DESC
                LIMIT $limit
                """,
                limit=limit,
            )
            return [dict(r["t"]) async for r in result]

    async def list_decks(
        self,
        leader: str | None = None,
        archetype: str | None = None,
        tournament_id: str | None = None,
        max_placement: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        conditions = []
        params: dict = {"limit": limit, "offset": offset}

        if leader:
            conditions.append("d.leader_id = $leader")
            params["leader"] = leader
        if archetype:
            conditions.append("toLower(d.archetype) CONTAINS toLower($archetype)")
            params["archetype"] = archetype
        if tournament_id:
            conditions.append("t.id = $tournament_id")
            params["tournament_id"] = tournament_id
        if max_placement:
            conditions.append("d.placement <= $max_placement")
            params["max_placement"] = max_placement

        where = "WHERE " + " AND ".join(conditions) if conditions else ""

        async with self.driver.session() as session:
            result = await session.run(
                f"""
                MATCH (d:Deck)
                OPTIONAL MATCH (d)-[:PLACED_IN]->(t:Tournament)
                OPTIONAL MATCH (d)-[:USES_LEADER]->(leader:Card)
                {where}
                RETURN d, t, leader
                ORDER BY d.placement ASC
                SKIP $offset LIMIT $limit
                """,
                **params,
            )
            decks = []
            async for r in result:
                decks.append(
                    {
                        "deck": dict(r["d"]),
                        "tournament": dict(r["t"]) if r["t"] else None,
                        "leader": dict(r["leader"]) if r["leader"] else None,
                    }
                )
            return decks

    async def get_deck_detail(self, deck_id: str) -> dict | None:
        async with self.driver.session() as session:
            result = await session.run(
                """
                MATCH (d:Deck {id: $deck_id})
                OPTIONAL MATCH (d)-[:PLACED_IN]->(t:Tournament)
                OPTIONAL MATCH (d)-[:USES_LEADER]->(leader:Card)
                RETURN d, t, leader
                """,
                deck_id=deck_id,
            )
            record = await result.single()
            if not record:
                return None

            cards_result = await session.run(
                """
                MATCH (d:Deck {id: $deck_id})-[inc:INCLUDES]->(c:Card)
                OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
                WITH c, inc.count AS count, collect(DISTINCT k.name) AS keywords
                RETURN c, count, keywords
                ORDER BY c.card_type ASC, c.cost ASC
                """,
                deck_id=deck_id,
            )
            cards = []
            async for cr in cards_result:
                cards.append(
                    {
                        "card": dict(cr["c"]),
                        "count": cr["count"] or 1,
                        "keywords": cr["keywords"] or [],
                    }
                )

            return {
                "deck": dict(record["d"]),
                "tournament": dict(record["t"]) if record["t"] else None,
                "leader": dict(record["leader"]) if record["leader"] else None,
                "cards": cards,
            }

    async def get_overview(self) -> dict:
        async with self.driver.session() as session:
            count_r = await session.run("MATCH (d:Deck) RETURN count(d) AS decks")
            rec = await count_r.single()
            total_decks = rec["decks"] if rec else 0

            t_r = await session.run("MATCH (t:Tournament) RETURN count(t) AS tournaments")
            t_rec = await t_r.single()
            total_tournaments = t_rec["tournaments"] if t_rec else 0

            arch_r = await session.run(
                """
                MATCH (d:Deck)
                WHERE d.archetype IS NOT NULL AND d.archetype <> ''
                RETURN d.archetype AS archetype, count(d) AS cnt
                ORDER BY cnt DESC LIMIT 20
                """
            )
            archetypes = []
            async for r in arch_r:
                archetypes.append(
                    {
                        "archetype": r["archetype"],
                        "count": r["cnt"],
                        "share": r["cnt"] / total_decks if total_decks else 0,
                    }
                )

            leader_r = await session.run(
                """
                MATCH (d:Deck)-[:USES_LEADER]->(c:Card)
                RETURN c.id AS id, c.name AS name, count(d) AS cnt
                ORDER BY cnt DESC LIMIT 15
                """
            )
            top_leaders = [
                {"id": r["id"], "name": r["name"], "deck_count": r["cnt"]} async for r in leader_r
            ]

        return {
            "total_decks": total_decks,
            "total_tournaments": total_tournaments,
            "top_archetypes": archetypes,
            "top_leaders": top_leaders,
        }

    async def get_leader_meta(self, leader_id: str) -> dict:
        async with self.driver.session() as session:
            result = await session.run(
                """
                MATCH (d:Deck)-[:USES_LEADER]->(leader:Card {id: $leader_id})
                RETURN leader.name AS leader_name,
                       count(d) AS total_decks,
                       avg(d.placement) AS avg_placement,
                       count(CASE WHEN d.placement <= 8 THEN 1 END) AS top_cut_count,
                       collect(DISTINCT d.archetype)[..5] AS top_archetypes
                """,
                leader_id=leader_id,
            )
            record = await result.single()
            if not record or record["total_decks"] == 0:
                return {"leader_id": leader_id, "total_decks": 0}

            cards_r = await session.run(
                """
                MATCH (d:Deck {leader_id: $leader_id})-[inc:INCLUDES]->(c:Card)
                WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
                ORDER BY deck_count DESC LIMIT 20
                RETURN c.id AS id, c.name AS name, c.card_type AS card_type,
                       c.cost AS cost, c.image_small AS image_small,
                       deck_count, avg_copies
                """,
                leader_id=leader_id,
            )
            popular = [dict(r) async for r in cards_r]

        return {
            "leader_id": leader_id,
            "leader_name": record["leader_name"] or "",
            "total_decks": record["total_decks"],
            "avg_placement": round(record["avg_placement"], 1) if record["avg_placement"] else None,
            "top_cut_count": record["top_cut_count"],
            "top_archetypes": record["top_archetypes"] or [],
            "popular_cards": popular,
        }
