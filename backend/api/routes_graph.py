"""Graph query API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import AsyncDriver

from backend.api.models import (
    CardResponse,
    CurveResponse,
    CurveEntry,
    HubCard,
    NetworkResponse,
    StatsResponse,
    SynergyPartner,
    SynergyResponse,
)
from backend.graph.connection import get_driver
from backend.graph.queries import (
    get_card_by_id,
    get_card_synergies,
    get_card_network,
    search_cards,
    get_db_stats,
)

router = APIRouter(prefix="/api/graph", tags=["graph"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


@router.get("/card/{card_id}", response_model=CardResponse)
async def get_card(card_id: str, driver: AsyncDriver = Depends(_get_driver)):
    card = await get_card_by_id(driver, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail=f"Card {card_id} not found")
    return card


@router.get("/card/{card_id}/synergies", response_model=SynergyResponse)
async def get_synergies(
    card_id: str,
    max_hops: int = Query(1, ge=1, le=3),
    color: str | None = None,
    driver: AsyncDriver = Depends(_get_driver),
):
    partners = await get_card_synergies(driver, card_id, max_hops, color)
    return SynergyResponse(
        card_id=card_id,
        partners=[SynergyPartner(**{k: p.get(k) for k in SynergyPartner.model_fields}) for p in partners],
        total=len(partners),
    )


@router.get("/card/{card_id}/network", response_model=NetworkResponse)
async def get_network(
    card_id: str,
    hops: int = Query(2, ge=1, le=3),
    driver: AsyncDriver = Depends(_get_driver),
):
    return await get_card_network(driver, card_id, hops)


@router.get("/leader/{leader_id}/deck-candidates")
async def get_deck_candidates(
    leader_id: str,
    limit: int = Query(50, ge=1, le=200),
    driver: AsyncDriver = Depends(_get_driver),
):
    """Find deck candidate cards for a leader based on family + color synergy."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (l:Card {id: $leader_id, card_type: 'LEADER'})
            MATCH (l)-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(card:Card)
            WHERE card.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
            WITH l, card, collect(DISTINCT f.name) AS shared_families
            MATCH (l)-[:HAS_COLOR]->(c:Color)<-[:HAS_COLOR]-(card)
            WITH card, shared_families, collect(DISTINCT c.name) AS shared_colors
            RETURN card, shared_families, shared_colors
            ORDER BY size(shared_families) DESC, card.cost ASC
            LIMIT $limit
            """,
            leader_id=leader_id,
            limit=limit,
        )
        records = [r async for r in result]
        return [
            {
                **dict(r["card"]),
                "shared_families": r["shared_families"],
                "shared_colors": r["shared_colors"],
            }
            for r in records
        ]


@router.get("/query/counters")
async def get_counters(
    against: str = Query(..., description="Card ID to counter"),
    color: str | None = None,
    driver: AsyncDriver = Depends(_get_driver),
):
    """Find cards that counter a specific card."""
    color_clause = "AND (counter)-[:HAS_COLOR]->(:Color {name: $color})" if color else ""
    params: dict = {"target_id": against}
    if color:
        params["color"] = color

    async with driver.session() as session:
        result = await session.run(
            f"""
            MATCH (counter:Card)-[r:COUNTERS]->(target:Card {{id: $target_id}})
            WHERE counter.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
            {color_clause}
            RETURN counter, r.reason AS reason
            LIMIT 20
            """,
            **params,
        )
        records = [r async for r in result]
        return [{"card": dict(r["counter"]), "reason": r["reason"]} for r in records]


@router.get("/query/curve")
async def get_curve(
    color: str | None = None,
    family: str | None = None,
    driver: AsyncDriver = Depends(_get_driver),
):
    """Get mana curve distribution for cards matching filters."""
    conditions = ["c.card_type IN ['CHARACTER', 'EVENT', 'STAGE']", "c.cost IS NOT NULL"]
    params: dict = {}
    if color:
        conditions.append("(c)-[:HAS_COLOR]->(:Color {name: $color})")
        params["color"] = color
    if family:
        conditions.append("(c)-[:BELONGS_TO]->(:Family {name: $family})")
        params["family"] = family

    where = "WHERE " + " AND ".join(conditions)

    async with driver.session() as session:
        result = await session.run(
            f"""
            MATCH (c:Card) {where}
            RETURN c.cost AS cost, count(c) AS count, collect(c.id) AS card_ids
            ORDER BY cost
            """,
            **params,
        )
        entries = []
        total = 0
        async for r in result:
            entries.append(CurveEntry(cost=r["cost"], count=r["count"], cards=r["card_ids"][:10]))
            total += r["count"]
        return CurveResponse(curve=entries, total=total)


@router.get("/stats/hubs")
async def get_hubs(
    color: str | None = None,
    top: int = Query(10, ge=1, le=50),
    driver: AsyncDriver = Depends(_get_driver),
):
    """Get most connected cards (hub cards)."""
    color_clause = "MATCH (c)-[:HAS_COLOR]->(:Color {name: $color})" if color else ""
    params: dict = {"top": top}
    if color:
        params["color"] = color

    async with driver.session() as session:
        result = await session.run(
            f"""
            MATCH (c:Card)
            WHERE c.card_type IN ['CHARACTER', 'LEADER', 'EVENT', 'STAGE']
            {color_clause}
            WITH c, COUNT {{ (c)-[:SYNERGY|MECHANICAL_SYNERGY]-() }} AS degree
            RETURN c.id AS id, c.name AS name, degree
            ORDER BY degree DESC
            LIMIT $top
            """,
            **params,
        )
        return [HubCard(**dict(r)) async for r in result]


@router.get("/search")
async def search(
    keyword: str | None = None,
    cost_max: int | None = None,
    color: str | None = None,
    card_type: str | None = None,
    family: str | None = None,
    limit: int = Query(25, ge=1, le=100),
    driver: AsyncDriver = Depends(_get_driver),
):
    """Search cards with filters."""
    return await search_cards(driver, keyword, cost_max, color, card_type, family, limit)


@router.get("/stats", response_model=StatsResponse)
async def stats(driver: AsyncDriver = Depends(_get_driver)):
    return await get_db_stats(driver)
