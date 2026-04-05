"""Meta / Tournament API endpoints — browse tournament decks, meta stats."""

from fastapi import APIRouter, Depends, Query
from neo4j import AsyncDriver

from backend.graph.connection import get_driver
from backend.api.models import (
    TournamentResponse,
    MetaDeckSummary,
    MetaDeckDetail,
    MetaDeckCard,
    MetaOverviewResponse,
    MetaOverviewArchetype,
    LeaderMetaResponse,
    SwapRequest,
    SwapSuggestion,
)

router = APIRouter(prefix="/api/meta", tags=["meta"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


@router.get("/tournaments", response_model=list[TournamentResponse])
async def list_tournaments(
    limit: int = Query(50, le=200),
    driver: AsyncDriver = Depends(_get_driver),
):
    """List all crawled tournaments, sorted by player count desc."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (t:Tournament)
            RETURN t
            ORDER BY t.player_count DESC
            LIMIT $limit
            """,
            limit=limit,
        )
        tournaments = []
        async for record in result:
            t = dict(record["t"])
            tournaments.append(TournamentResponse(**t))
    return tournaments


@router.get("/decks", response_model=list[MetaDeckSummary])
async def list_decks(
    leader: str | None = Query(None, description="Filter by leader card ID"),
    archetype: str | None = Query(None, description="Filter by archetype name (substring)"),
    tournament_id: str | None = Query(None, description="Filter by tournament ID"),
    max_placement: int | None = Query(None, description="Only top N placements"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    driver: AsyncDriver = Depends(_get_driver),
):
    """Browse tournament decks with optional filters."""
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

    async with driver.session() as session:
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
        async for record in result:
            d = dict(record["d"])
            t = dict(record["t"]) if record["t"] else None
            leader_card = dict(record["leader"]) if record["leader"] else None

            decks.append(MetaDeckSummary(
                id=d.get("id", ""),
                leader_id=d.get("leader_id", ""),
                leader_name=leader_card.get("name", "") if leader_card else "",
                archetype=d.get("archetype", ""),
                placement=d.get("placement"),
                player_name=d.get("player_name", ""),
                tournament=TournamentResponse(**t) if t else None,
            ))
    return decks


@router.get("/decks/{deck_id}", response_model=MetaDeckDetail)
async def get_deck_detail(
    deck_id: str,
    driver: AsyncDriver = Depends(_get_driver),
):
    """Get full deck detail with all cards."""
    async with driver.session() as session:
        # Deck + leader + tournament
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
            return MetaDeckDetail(id=deck_id)

        d = dict(record["d"])
        t = dict(record["t"]) if record["t"] else None
        leader_card = dict(record["leader"]) if record["leader"] else None

        # Get all cards in deck
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
        type_dist: dict[str, int] = {}
        total_cards = 0
        async for card_record in cards_result:
            c = dict(card_record["c"])
            count = card_record["count"] or 1
            keywords = card_record["keywords"] or []

            card_type = c.get("card_type", "")
            type_dist[card_type] = type_dist.get(card_type, 0) + count
            total_cards += count

            cards.append(MetaDeckCard(
                id=c.get("id", ""),
                name=c.get("name", ""),
                card_type=card_type,
                cost=c.get("cost"),
                power=c.get("power"),
                counter=c.get("counter"),
                count=count,
                image_small=c.get("image_small", ""),
                keywords=keywords,
            ))

    return MetaDeckDetail(
        id=d.get("id", ""),
        leader_id=d.get("leader_id", ""),
        leader_name=leader_card.get("name", "") if leader_card else "",
        archetype=d.get("archetype", ""),
        placement=d.get("placement"),
        player_name=d.get("player_name", ""),
        tournament=TournamentResponse(**t) if t else None,
        cards=cards,
        total_cards=total_cards,
        type_distribution=type_dist,
        leader_image=leader_card.get("image_small", "") if leader_card else "",
    )


@router.get("/overview", response_model=MetaOverviewResponse)
async def meta_overview(driver: AsyncDriver = Depends(_get_driver)):
    """Get current meta overview: top archetypes, leader popularity."""
    async with driver.session() as session:
        # Total counts
        count_result = await session.run(
            "MATCH (d:Deck) RETURN count(d) AS decks"
        )
        count_record = await count_result.single()
        total_decks = count_record["decks"] if count_record else 0

        t_result = await session.run(
            "MATCH (t:Tournament) RETURN count(t) AS tournaments"
        )
        t_record = await t_result.single()
        total_tournaments = t_record["tournaments"] if t_record else 0

        # Top archetypes
        arch_result = await session.run(
            """
            MATCH (d:Deck)
            WHERE d.archetype IS NOT NULL AND d.archetype <> ''
            RETURN d.archetype AS archetype, count(d) AS cnt
            ORDER BY cnt DESC
            LIMIT 20
            """
        )
        archetypes = []
        async for r in arch_result:
            archetypes.append(MetaOverviewArchetype(
                archetype=r["archetype"],
                count=r["cnt"],
                share=r["cnt"] / total_decks if total_decks else 0,
            ))

        # Top leaders
        leader_result = await session.run(
            """
            MATCH (d:Deck)-[:USES_LEADER]->(c:Card)
            RETURN c.id AS id, c.name AS name, count(d) AS cnt
            ORDER BY cnt DESC
            LIMIT 15
            """
        )
        top_leaders = []
        async for r in leader_result:
            top_leaders.append({
                "id": r["id"],
                "name": r["name"],
                "deck_count": r["cnt"],
            })

    return MetaOverviewResponse(
        total_decks=total_decks,
        total_tournaments=total_tournaments,
        top_archetypes=archetypes,
        top_leaders=top_leaders,
    )


@router.get("/leader/{leader_id}", response_model=LeaderMetaResponse)
async def leader_meta(
    leader_id: str,
    driver: AsyncDriver = Depends(_get_driver),
):
    """Get tournament meta stats for a specific leader."""
    async with driver.session() as session:
        # Basic stats
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
            return LeaderMetaResponse(leader_id=leader_id)

        # Most popular cards for this leader
        cards_result = await session.run(
            """
            MATCH (d:Deck {leader_id: $leader_id})-[inc:INCLUDES]->(c:Card)
            WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
            ORDER BY deck_count DESC
            LIMIT 20
            RETURN c.id AS id, c.name AS name, c.card_type AS card_type,
                   c.cost AS cost, c.image_small AS image_small,
                   deck_count, avg_copies
            """,
            leader_id=leader_id,
        )
        popular_cards = []
        async for r in cards_result:
            popular_cards.append(MetaDeckCard(
                id=r["id"],
                name=r["name"],
                card_type=r["card_type"] or "",
                cost=r["cost"],
                count=round(r["avg_copies"]) if r["avg_copies"] else 1,
                image_small=r["image_small"] or "",
            ))

    return LeaderMetaResponse(
        leader_id=leader_id,
        leader_name=record["leader_name"] or "",
        total_decks=record["total_decks"],
        avg_placement=round(record["avg_placement"], 1) if record["avg_placement"] else None,
        top_cut_count=record["top_cut_count"],
        top_archetypes=record["top_archetypes"] or [],
        popular_cards=popular_cards,
    )


@router.post("/suggest-swap", response_model=SwapSuggestion | None)
async def suggest_swap(
    req: SwapRequest,
    driver: AsyncDriver = Depends(_get_driver),
):
    """Suggest which card to remove when adding a new card (1 in > 1 out).

    Analyzes current deck and suggests the weakest card to swap out,
    based on tournament pick rate, role coverage, and cost curve impact.
    """
    if not req.deck_card_ids or not req.incoming_card_id:
        return None

    async with driver.session() as session:
        # Get incoming card info
        inc_result = await session.run(
            """
            MATCH (c:Card {id: $card_id})
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            RETURN c, collect(DISTINCT k.name) AS keywords
            """,
            card_id=req.incoming_card_id,
        )
        inc_record = await inc_result.single()
        if not inc_record:
            return None

        incoming = dict(inc_record["c"])
        incoming["keywords"] = inc_record["keywords"]

        # Get all deck cards with meta stats
        deck_result = await session.run(
            """
            UNWIND $card_ids AS cid
            MATCH (c:Card {id: cid})
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            RETURN c, collect(DISTINCT k.name) AS keywords
            """,
            card_ids=req.deck_card_ids,
        )

        deck_cards = []
        async for r in deck_result:
            card = dict(r["c"])
            card["keywords"] = r["keywords"]
            deck_cards.append(card)

    if not deck_cards:
        return None

    # Score each deck card — lowest score = best candidate to remove
    def card_value(card: dict) -> float:
        score = 0.0
        pick_rate = card.get("tournament_pick_rate") or 0
        top_cut = card.get("top_cut_rate") or 0
        score += pick_rate * 3.0 + top_cut * 5.0
        counter = card.get("counter") or 0
        score += min(counter / 1000, 2.0)
        keywords = set(card.get("keywords", []))
        if keywords & {"Blocker", "Rush", "Draw", "Search", "KO", "Bounce"}:
            score += 1.0
        return score

    # Find the weakest card that shares a similar role/cost slot
    incoming_cost = incoming.get("cost") or 0
    candidates = []
    for card in deck_cards:
        # Prefer replacing cards with same cost range (±2)
        card_cost = card.get("cost") or 0
        cost_penalty = abs(card_cost - incoming_cost) * 0.1
        value = card_value(card) - cost_penalty
        candidates.append((value, card))

    candidates.sort(key=lambda x: x[0])

    if not candidates:
        return None

    weakest = candidates[0][1]

    reason_parts = []
    if (incoming.get("tournament_pick_rate") or 0) > (weakest.get("tournament_pick_rate") or 0):
        reason_parts.append("higher tournament pick rate")
    if (incoming.get("top_cut_rate") or 0) > (weakest.get("top_cut_rate") or 0):
        reason_parts.append("better top-cut performance")
    if not reason_parts:
        reason_parts.append("better overall value for this deck")

    return SwapSuggestion(
        remove_id=weakest.get("id", ""),
        remove_name=weakest.get("name", ""),
        add_id=incoming.get("id", ""),
        add_name=incoming.get("name", ""),
        reason=f"Swap recommended: {'; '.join(reason_parts)}",
    )
