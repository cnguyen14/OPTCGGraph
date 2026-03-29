"""Build nodes and edges in Neo4j from merged card data."""

from neo4j import AsyncDriver


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

            # Color edges (handle multi-color: "Red/Green" → 2 edges)
            for color in _split_field(card.get("color", "")):
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
