"""Build nodes and edges in Neo4j from merged card data."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from neo4j import AsyncDriver

from backend.graph.batch import batch_write, RELATIONSHIP_CHUNK_SIZE

if TYPE_CHECKING:
    from backend.crawlers.tracer import CrawlTracer

logger = logging.getLogger(__name__)


async def create_indexes(driver: AsyncDriver) -> None:
    """Create indexes on Card nodes for fast lookups."""
    queries = [
        "CREATE INDEX card_id IF NOT EXISTS FOR (c:Card) ON (c.id)",
        "CREATE INDEX card_name IF NOT EXISTS FOR (c:Card) ON (c.name)",
        "CREATE INDEX card_cost IF NOT EXISTS FOR (c:Card) ON (c.cost)",
        "CREATE INDEX card_type IF NOT EXISTS FOR (c:Card) ON (c.card_type)",
        "CREATE INDEX color_name IF NOT EXISTS FOR (c:Color) ON (c.name)",
        "CREATE INDEX family_name IF NOT EXISTS FOR (f:Family) ON (f.name)",
        "CREATE INDEX set_id IF NOT EXISTS FOR (s:Set) ON (s.id)",
        "CREATE INDEX keyword_name IF NOT EXISTS FOR (k:Keyword) ON (k.name)",
    ]
    async with driver.session() as session:
        for q in queries:
            await session.run(q)

    # Fulltext index requires separate syntax
    async with driver.session() as session:
        try:
            await session.run(
                "CREATE FULLTEXT INDEX card_ability IF NOT EXISTS "
                "FOR (c:Card) ON EACH [c.ability]"
            )
        except Exception:
            pass  # May already exist


async def load_cards(
    driver: AsyncDriver, cards: list[dict], tracer: CrawlTracer | None = None
) -> int:
    """Load merged card data into Neo4j using UNWIND batching.

    Returns count of cards loaded.
    """
    if not cards:
        return 0

    t0 = time.time()
    if tracer:
        tracer.log("neo4j_start", step="load_cards", card_count=len(cards))

    # --- Precompute all data in Python ---
    card_params = [_card_params(c) for c in cards]

    color_edges: list[dict] = []
    for card in cards:
        for color in _split_colors(card.get("color", "")):
            color_edges.append({"card_id": card["id"], "color": color})

    family_edges: list[dict] = []
    for card in cards:
        for family in _split_field(card.get("family", ""), sep="/"):
            if family:
                family_edges.append({"card_id": card["id"], "family": family})

    set_edges: list[dict] = []
    for card in cards:
        set_id = card.get("set_id", "")
        if set_id:
            set_edges.append(
                {
                    "card_id": card["id"],
                    "set_id": set_id,
                    "set_name": card.get("set_name", ""),
                }
            )

    # --- Batch write to Neo4j ---

    # 1. Card nodes
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (c:Card {id: row.id})
        SET c.code = row.code,
            c.name = row.name,
            c.card_type = row.card_type,
            c.cost = row.cost,
            c.power = row.power,
            c.counter = row.counter,
            c.rarity = row.rarity,
            c.attribute = row.attribute,
            c.ability = row.ability,
            c.trigger_effect = row.trigger_effect,
            c.image_small = row.image_small,
            c.image_large = row.image_large,
            c.inventory_price = row.inventory_price,
            c.market_price = row.market_price,
            c.source_apitcg = row.source_apitcg,
            c.source_optcgapi = row.source_optcgapi,
            c.source_bandai = row.source_bandai,
            c.life = row.life
        """,
        card_params,
        label="Cards",
    )

    # 2. Color edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (color:Color {name: row.color})
        WITH color, row
        MATCH (c:Card {id: row.card_id})
        MERGE (c)-[:HAS_COLOR]->(color)
        """,
        color_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="Color edges",
    )

    # 3. Family edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (f:Family {name: row.family})
        WITH f, row
        MATCH (c:Card {id: row.card_id})
        MERGE (c)-[:BELONGS_TO]->(f)
        """,
        family_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="Family edges",
    )

    # 4. Set edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (s:Set {id: row.set_id})
        SET s.name = row.set_name
        WITH s, row
        MATCH (c:Card {id: row.card_id})
        MERGE (c)-[:FROM_SET]->(s)
        """,
        set_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="Set edges",
    )

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(
        f"Loaded {len(cards)} cards, {len(color_edges)} color edges, "
        f"{len(family_edges)} family edges, {len(set_edges)} set edges "
        f"({latency_ms}ms)"
    )
    if tracer:
        tracer.log(
            "neo4j_finish",
            step="load_cards",
            card_count=len(cards),
            color_edges=len(color_edges),
            family_edges=len(family_edges),
            set_edges=len(set_edges),
            latency_ms=latency_ms,
        )
    return len(cards)


def _card_params(card: dict) -> dict:
    """Extract card parameters for Cypher query."""
    return {
        "id": card.get("id", ""),
        "code": card.get("code", card.get("id", "")),
        "name": card.get("name", ""),
        "card_type": card.get("card_type", ""),
        "cost": _to_int(card.get("cost")),
        "power": _to_int(card.get("power")),
        "counter": _to_int(card.get("counter")),
        "rarity": card.get("rarity", ""),
        "attribute": card.get("attribute", ""),
        "ability": card.get("ability", ""),
        "trigger_effect": card.get("trigger_effect", ""),
        "image_small": card.get("image_small", ""),
        "image_large": card.get("image_large", ""),
        "inventory_price": _to_float(card.get("inventory_price")),
        "market_price": _to_float(card.get("market_price")),
        "source_apitcg": card.get("source_apitcg", False),
        "source_optcgapi": card.get("source_optcgapi", False),
        "source_bandai": card.get("source_bandai", False),
        "life": card.get("life", ""),
    }


def _to_int(val) -> int | None:
    """Convert value to int, return None if not possible."""
    if val is None or val == "" or val == "-":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _to_float(val) -> float | None:
    """Convert value to float, return None if not possible."""
    if val is None or val == "" or val == "-":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _split_field(value: str, sep: str = "/") -> list[str]:
    """Split a field value by separator, stripping whitespace."""
    if not value or value == "-":
        return []
    return [v.strip() for v in value.split(sep) if v.strip()]


KNOWN_COLORS = {"Red", "Green", "Blue", "Purple", "Black", "Yellow"}


def _split_colors(value: str) -> list[str]:
    """Split color string into individual color names.

    Handles: "Red" → ["Red"], "Red Black" → ["Red", "Black"],
    "Blue/Green" → ["Blue", "Green"], "Blue Purple" → ["Blue", "Purple"]
    """
    if not value or value == "-":
        return []
    # First try "/" separator (apitcg format)
    if "/" in value:
        return [v.strip() for v in value.split("/") if v.strip()]
    # Then try splitting by known color names (optcgapi space-separated format)
    colors = []
    remaining = value.strip()
    for color in sorted(KNOWN_COLORS, key=len, reverse=True):
        if color in remaining:
            colors.append(color)
            remaining = remaining.replace(color, "", 1).strip()
    return colors if colors else [value]


async def create_meta_indexes(driver: AsyncDriver) -> None:
    """Create indexes for tournament/deck nodes."""
    queries = [
        "CREATE INDEX tournament_id IF NOT EXISTS FOR (t:Tournament) ON (t.id)",
        "CREATE INDEX deck_id IF NOT EXISTS FOR (d:Deck) ON (d.id)",
        "CREATE INDEX deck_leader IF NOT EXISTS FOR (d:Deck) ON (d.leader_id)",
        "CREATE INDEX deck_archetype IF NOT EXISTS FOR (d:Deck) ON (d.archetype)",
    ]
    async with driver.session() as session:
        for q in queries:
            await session.run(q)


async def load_tournament_data(
    driver: AsyncDriver,
    tournaments: list[dict],
    decks: list[dict],
    tracer: CrawlTracer | None = None,
) -> dict:
    """Load tournament and deck data into Neo4j using UNWIND batching.

    Returns: {"tournaments": int, "decks": int, "includes_edges": int}
    """
    t0 = time.time()
    if tracer:
        tracer.log(
            "neo4j_start",
            step="load_tournament_data",
            tournament_count=len(tournaments),
            deck_count=len(decks),
        )

    # --- Precompute all data in Python ---
    tournament_params = [
        {
            "id": str(t["id"]),
            "name": t.get("name", ""),
            "date": t.get("date", ""),
            "format": t.get("format", ""),
            "player_count": t.get("player_count", 0),
            "source": t.get("source", "limitlesstcg"),
        }
        for t in tournaments
    ]

    deck_params: list[dict] = []
    leader_edges: list[dict] = []
    placed_in_edges: list[dict] = []
    includes_edges: list[dict] = []

    for deck in decks:
        deck_id = str(deck["id"])
        leader_id = deck.get("leader_id", "")

        deck_params.append(
            {
                "id": deck_id,
                "archetype": deck.get("archetype", ""),
                "placement": deck.get("placement"),
                "player_name": deck.get("player_name", ""),
                "leader_id": leader_id,
                "source": deck.get("source", "limitlesstcg"),
            }
        )

        if leader_id:
            leader_edges.append({"deck_id": deck_id, "leader_id": leader_id})

        tournament_id = deck.get("tournament_id")
        if tournament_id:
            placed_in_edges.append(
                {
                    "deck_id": deck_id,
                    "tournament_id": str(tournament_id),
                }
            )

        for card_entry in deck.get("cards", []):
            includes_edges.append(
                {
                    "deck_id": deck_id,
                    "card_id": card_entry["id"],
                    "count": card_entry.get("count", 1),
                }
            )

    # --- Batch write to Neo4j ---

    # 1. Tournament nodes
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (t:Tournament {id: row.id})
        SET t.name = row.name,
            t.date = row.date,
            t.format = row.format,
            t.player_count = row.player_count,
            t.source = row.source
        """,
        tournament_params,
        label="Tournaments",
    )

    # 2. Deck nodes
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (d:Deck {id: row.id})
        SET d.archetype = row.archetype,
            d.placement = row.placement,
            d.player_name = row.player_name,
            d.leader_id = row.leader_id,
            d.source = row.source
        """,
        deck_params,
        label="Decks",
    )

    # 3. USES_LEADER edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (d:Deck {id: row.deck_id})
        MATCH (c:Card {id: row.leader_id})
        MERGE (d)-[:USES_LEADER]->(c)
        """,
        leader_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="USES_LEADER edges",
    )

    # 4. PLACED_IN edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (d:Deck {id: row.deck_id})
        MATCH (t:Tournament {id: row.tournament_id})
        MERGE (d)-[:PLACED_IN]->(t)
        """,
        placed_in_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="PLACED_IN edges",
    )

    # 5. INCLUDES edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (d:Deck {id: row.deck_id})
        MATCH (c:Card {id: row.card_id})
        MERGE (d)-[inc:INCLUDES]->(c)
        SET inc.count = row.count
        """,
        includes_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="INCLUDES edges",
    )

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(
        f"Loaded {len(tournament_params)} tournaments, {len(deck_params)} decks, "
        f"{len(includes_edges)} INCLUDES edges ({latency_ms}ms)"
    )
    if tracer:
        tracer.log(
            "neo4j_finish",
            step="load_tournament_data",
            tournaments=len(tournament_params),
            decks=len(deck_params),
            leader_edges=len(leader_edges),
            placed_in_edges=len(placed_in_edges),
            includes_edges=len(includes_edges),
            latency_ms=latency_ms,
        )
    return {
        "tournaments": len(tournament_params),
        "decks": len(deck_params),
        "includes_edges": len(includes_edges),
    }


async def compute_card_meta_stats(
    driver: AsyncDriver, tracer: CrawlTracer | None = None
) -> int:
    """Compute tournament popularity stats and store on Card nodes.

    Sets: tournament_pick_rate, avg_copies, top_cut_rate
    Returns: number of cards updated.
    """
    t0 = time.time()
    async with driver.session() as session:
        # Overall pick rate + avg copies
        result = await session.run(
            """
            MATCH (d:Deck)-[inc:INCLUDES]->(c:Card)
            WITH c, count(DISTINCT d) AS deck_count, avg(inc.count) AS avg_copies
            WITH c, deck_count, avg_copies,
                 toFloat(deck_count) AS dc
            CALL {
                MATCH (d2:Deck) RETURN count(d2) AS total_decks
            }
            SET c.tournament_pick_rate = dc / total_decks,
                c.avg_copies = round(avg_copies * 100) / 100
            RETURN count(c) AS updated
            """
        )
        record = await result.single()
        pick_updated = record["updated"] if record else 0

        # Top cut rate (placement <= 8)
        await session.run(
            """
            MATCH (d:Deck)-[inc:INCLUDES]->(c:Card)
            WHERE d.placement IS NOT NULL AND d.placement <= 8
            WITH c, count(DISTINCT d) AS top_cut_count
            CALL {
                MATCH (d2:Deck) WHERE d2.placement IS NOT NULL AND d2.placement <= 8
                RETURN count(d2) AS total_top_cut
            }
            SET c.top_cut_rate = toFloat(top_cut_count) / total_top_cut
            """
        )

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(f"Computed meta stats for {pick_updated} cards ({latency_ms}ms)")
    if tracer:
        tracer.log(
            "neo4j_finish",
            step="compute_meta_stats",
            cards_updated=pick_updated,
            latency_ms=latency_ms,
        )
    return pick_updated


async def apply_ban_list(
    driver: AsyncDriver,
    banned_cards: list[dict],
    tracer: CrawlTracer | None = None,
) -> int:
    """Apply banned card list to Neo4j using UNWIND batching.

    Args:
        driver: Neo4j async driver
        banned_cards: List of dicts with card_id, status, reason
        tracer: Optional CrawlTracer for logging

    Returns:
        Number of entries processed.
    """
    if not banned_cards:
        return 0

    async with driver.session() as session:
        # Clear all existing bans
        await session.run(
            "MATCH (c:Card) WHERE c.banned = true SET c.banned = false, c.ban_reason = ''"
        )

    # Apply new bans in batch
    ban_params = [
        {
            "id": entry.get("card_id", ""),
            "reason": entry.get("reason", "Officially banned by Bandai"),
        }
        for entry in banned_cards
    ]

    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (c:Card {id: row.id})
        SET c.banned = true, c.ban_reason = row.reason
        """,
        ban_params,
        label="Ban list",
    )

    logger.info(f"Marked {len(banned_cards)} cards as banned")
    if tracer:
        tracer.log(
            "neo4j_finish",
            step="apply_ban_list",
            banned_count=len(banned_cards),
        )
    return len(banned_cards)
