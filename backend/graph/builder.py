"""Build nodes and edges in Neo4j from merged card data."""

import logging

from neo4j import AsyncDriver

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


async def load_cards(driver: AsyncDriver, cards: list[dict]) -> int:
    """Load merged card data into Neo4j. Returns count of cards loaded."""
    loaded = 0

    async with driver.session() as session:
        for card in cards:
            # MERGE Card node
            await session.run(
                """
                MERGE (c:Card {id: $id})
                SET c.code = $code,
                    c.name = $name,
                    c.card_type = $card_type,
                    c.cost = $cost,
                    c.power = $power,
                    c.counter = $counter,
                    c.rarity = $rarity,
                    c.attribute = $attribute,
                    c.ability = $ability,
                    c.trigger_effect = $trigger_effect,
                    c.image_small = $image_small,
                    c.image_large = $image_large,
                    c.inventory_price = $inventory_price,
                    c.market_price = $market_price,
                    c.source_apitcg = $source_apitcg,
                    c.source_optcgapi = $source_optcgapi,
                    c.life = $life
                """,
                **_card_params(card),
            )

            # Color edges (handle multi-color: "Red Black" → 2 edges)
            for color in _split_colors(card.get("color", "")):
                await session.run(
                    """
                    MERGE (color:Color {name: $color})
                    WITH color
                    MATCH (c:Card {id: $card_id})
                    MERGE (c)-[:HAS_COLOR]->(color)
                    """,
                    color=color,
                    card_id=card["id"],
                )

            # Family edges (handle multi-family: "Water Seven/Straw Hat Crew")
            for family in _split_field(card.get("family", ""), sep="/"):
                if not family:
                    continue
                await session.run(
                    """
                    MERGE (f:Family {name: $family})
                    WITH f
                    MATCH (c:Card {id: $card_id})
                    MERGE (c)-[:BELONGS_TO]->(f)
                    """,
                    family=family,
                    card_id=card["id"],
                )

            # Set edge
            set_id = card.get("set_id", "")
            set_name = card.get("set_name", "")
            if set_id:
                await session.run(
                    """
                    MERGE (s:Set {id: $set_id})
                    SET s.name = $set_name
                    WITH s
                    MATCH (c:Card {id: $card_id})
                    MERGE (c)-[:FROM_SET]->(s)
                    """,
                    set_id=set_id,
                    set_name=set_name,
                    card_id=card["id"],
                )

            loaded += 1

    return loaded


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
) -> dict:
    """Load tournament and deck data into Neo4j.

    Returns: {"tournaments": int, "decks": int, "includes_edges": int}
    """
    t_count = 0
    d_count = 0
    inc_count = 0

    async with driver.session() as session:
        # Create Tournament nodes
        for t in tournaments:
            await session.run(
                """
                MERGE (t:Tournament {id: $id})
                SET t.name = $name,
                    t.date = $date,
                    t.format = $format,
                    t.player_count = $player_count,
                    t.source = $source
                """,
                id=str(t["id"]),
                name=t.get("name", ""),
                date=t.get("date", ""),
                format=t.get("format", ""),
                player_count=t.get("player_count", 0),
                source=t.get("source", "limitlesstcg"),
            )
            t_count += 1

        # Create Deck nodes + relationships
        for deck in decks:
            leader_id = deck.get("leader_id", "")
            deck_id = str(deck["id"])

            # Create Deck node
            await session.run(
                """
                MERGE (d:Deck {id: $id})
                SET d.archetype = $archetype,
                    d.placement = $placement,
                    d.player_name = $player_name,
                    d.leader_id = $leader_id,
                    d.source = $source
                """,
                id=deck_id,
                archetype=deck.get("archetype", ""),
                placement=deck.get("placement"),
                player_name=deck.get("player_name", ""),
                leader_id=leader_id,
                source=deck.get("source", "limitlesstcg"),
            )

            # USES_LEADER edge (Deck → Card)
            if leader_id:
                await session.run(
                    """
                    MATCH (d:Deck {id: $deck_id})
                    MATCH (c:Card {id: $leader_id})
                    MERGE (d)-[:USES_LEADER]->(c)
                    """,
                    deck_id=deck_id,
                    leader_id=leader_id,
                )

            # PLACED_IN edge (Deck → Tournament)
            tournament_id = deck.get("tournament_id")
            if tournament_id:
                await session.run(
                    """
                    MATCH (d:Deck {id: $deck_id})
                    MATCH (t:Tournament {id: $tournament_id})
                    MERGE (d)-[:PLACED_IN]->(t)
                    """,
                    deck_id=deck_id,
                    tournament_id=str(tournament_id),
                )

            # INCLUDES edges (Deck → Card) with count property
            for card_entry in deck.get("cards", []):
                card_id = card_entry["id"]
                count = card_entry.get("count", 1)
                await session.run(
                    """
                    MATCH (d:Deck {id: $deck_id})
                    MATCH (c:Card {id: $card_id})
                    MERGE (d)-[inc:INCLUDES]->(c)
                    SET inc.count = $count
                    """,
                    deck_id=deck_id,
                    card_id=card_id,
                    count=count,
                )
                inc_count += 1

            d_count += 1

    logger.info(
        f"Loaded {t_count} tournaments, {d_count} decks, {inc_count} INCLUDES edges"
    )
    return {"tournaments": t_count, "decks": d_count, "includes_edges": inc_count}


async def compute_card_meta_stats(driver: AsyncDriver) -> int:
    """Compute tournament popularity stats and store on Card nodes.

    Sets: tournament_pick_rate, avg_copies, top_cut_rate
    Returns: number of cards updated.
    """
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

    logger.info(f"Computed meta stats for {pick_updated} cards")
    return pick_updated
