"""LLM-based ability text parser using Claude API."""

import asyncio
import json
import logging
import re

import anthropic

from backend.services.settings_service import get_active_api_key
from backend.parser.prompts import ABILITY_PARSER_SYSTEM, ABILITY_PARSER_USER_TEMPLATE
from backend.parser.keywords import get_cost_tier, COST_TIERS

logger = logging.getLogger(__name__)

BATCH_SIZE = 15  # Cards per API call
MODEL = "claude-sonnet-4-20250514"


async def parse_abilities(cards: list[dict], batch_size: int = BATCH_SIZE) -> list[dict]:
    """Parse ability text for all cards using Claude API in batches.

    Returns list of parsed results: [{card_id, timing_keywords, ability_keywords, ...}]
    """
    api_key = get_active_api_key("claude")
    if not api_key:
        logger.warning("No Anthropic API key configured, using regex fallback parser")
        return [_regex_parse(c) for c in cards]

    client = anthropic.AsyncAnthropic(api_key=api_key)
    results: list[dict] = []

    # Filter cards that have ability text
    cards_with_abilities = [c for c in cards if c.get("ability") and c["ability"] != "-"]
    cards_without = [c for c in cards if not c.get("ability") or c["ability"] == "-"]

    # Empty ability cards get empty results
    for c in cards_without:
        results.append({
            "card_id": c["id"],
            "timing_keywords": [],
            "ability_keywords": [],
            "don_keywords": [],
            "effects": [],
            "extracted_keywords": [],
        })

    # Process in batches
    for i in range(0, len(cards_with_abilities), batch_size):
        batch = cards_with_abilities[i : i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(cards_with_abilities) + batch_size - 1) // batch_size
        logger.info(f"Parsing batch {batch_num}/{total_batches} ({len(batch)} cards)...")

        parsed = await _parse_batch(client, batch)
        results.extend(parsed)

        # Rate limit: small delay between batches
        if i + batch_size < len(cards_with_abilities):
            await asyncio.sleep(0.5)

    logger.info(f"Parsed {len(results)} card abilities")
    return results


async def _parse_batch(client: anthropic.AsyncAnthropic, batch: list[dict]) -> list[dict]:
    """Parse a batch of cards via Claude API."""
    cards_json = json.dumps(
        [{"card_id": c["id"], "name": c.get("name", ""), "ability": c.get("ability", "")}
         for c in batch],
        indent=2,
    )

    user_msg = ABILITY_PARSER_USER_TEMPLATE.format(cards_json=cards_json)

    try:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=ABILITY_PARSER_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )

        text = response.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text)

        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed

    except Exception as e:
        logger.error(f"LLM parse failed: {e}, falling back to regex")

    # Fallback: regex parse
    return [_regex_parse(c) for c in batch]


def _regex_parse(card: dict) -> dict:
    """Simple regex-based ability parser as fallback."""
    ability = card.get("ability", "") or ""
    card_id = card.get("id", "")

    timing = []
    abilities = []
    don_kw = []
    effects = []

    # Timing
    if "[On Play]" in ability or "On Play" in ability:
        timing.append("On Play")
    if "When Attacking" in ability:
        timing.append("When Attacking")
    if "[On K.O.]" in ability or "On K.O." in ability:
        timing.append("On K.O.")
    if "[Activate: Main]" in ability or "Activate: Main" in ability:
        timing.append("Activate: Main")
    if "On Your Opponent's Attack" in ability:
        timing.append("On Your Opponent's Attack")
    if "[Counter]" in ability:
        timing.append("Counter")
    if "[Trigger]" in ability:
        timing.append("Trigger")
    if "End of Turn" in ability or "end of your turn" in ability.lower():
        timing.append("End of Turn")
    if "Once Per Turn" in ability:
        timing.append("Once Per Turn")
    if "[On Block]" in ability:
        timing.append("On Block")

    # Abilities
    if "[Rush]" in ability or "Rush" in ability:
        abilities.append("Rush")
    if "[Blocker]" in ability or "Blocker" in ability:
        abilities.append("Blocker")
    if "[Double Attack]" in ability or "Double Attack" in ability:
        abilities.append("Double Attack")
    if "[Banish]" in ability or "Banish" in ability:
        abilities.append("Banish")

    # DON!!
    if "[DON!! x1]" in ability:
        don_kw.append("DON!! x1")
    if "[DON!! x2]" in ability:
        don_kw.append("DON!! x2")
    don_minus = re.findall(r"DON!!\s*[−-](\d+)", ability)
    for d in don_minus:
        don_kw.append(f"DON!! -{d}")
    don_plus = re.findall(r"DON!!\s*\+(\d+)", ability)
    for d in don_plus:
        don_kw.append(f"DON!! +{d}")

    # Effects
    if re.search(r"return.*to.*hand|return.*to.*owner", ability, re.I):
        effects.append("Bounce")
    if re.search(r"draw \d+ card|draw a card", ability, re.I):
        effects.append("Draw")
    if re.search(r"trash", ability, re.I):
        effects.append("Trash")
    if re.search(r"\bK\.?O\.?\b", ability) and "On K.O." not in ability:
        effects.append("KO")
    if re.search(r"look at.*top|add.*from.*deck.*to.*hand|search", ability, re.I):
        effects.append("Search")
    if re.search(r"\+\d+000 power|\bgain.*power\b", ability, re.I):
        effects.append("Power Buff")
    if re.search(r"-\d+000 power|reduce.*power|loses.*power", ability, re.I):
        effects.append("Power Debuff")
    if re.search(r"\brest\b", ability, re.I) and "rested" not in ability.lower():
        effects.append("Rest")
    if re.search(r"play.*from.*hand|play.*character", ability, re.I) and "[On Play]" not in ability:
        effects.append("Play")

    extracted = list(set(timing + abilities + don_kw + effects))

    return {
        "card_id": card_id,
        "timing_keywords": timing,
        "ability_keywords": abilities,
        "don_keywords": don_kw,
        "effects": effects,
        "extracted_keywords": extracted,
    }


async def build_keyword_graph(driver, parsed_results: list[dict], cards: list[dict]) -> int:
    """Create Keyword nodes, HAS_KEYWORD edges, CostTier nodes, and IN_COST_TIER edges."""
    card_map = {c["id"]: c for c in cards}
    edges_created = 0

    async with driver.session() as session:
        # Create CostTier nodes
        for tier in COST_TIERS:
            await session.run(
                "MERGE (t:CostTier {name: $name}) SET t.range_min = $min, t.range_max = $max",
                name=tier["name"],
                min=tier["range_min"],
                max=tier["range_max"],
            )

        # Create IN_COST_TIER edges for all cards
        for card in cards:
            cost = card.get("cost")
            if cost is not None:
                try:
                    cost_int = int(cost)
                except (ValueError, TypeError):
                    continue
                tier_name = get_cost_tier(cost_int)
                if tier_name:
                    await session.run(
                        """
                        MATCH (c:Card {id: $card_id})
                        MATCH (t:CostTier {name: $tier})
                        MERGE (c)-[:IN_COST_TIER]->(t)
                        """,
                        card_id=card["id"],
                        tier=tier_name,
                    )
                    edges_created += 1

        # Create Keyword nodes and HAS_KEYWORD edges from parsed results
        for parsed in parsed_results:
            card_id = parsed["card_id"]
            keywords = parsed.get("extracted_keywords", [])

            for kw in keywords:
                if not kw:
                    continue
                # Determine category
                category = "effect"
                if kw in parsed.get("timing_keywords", []):
                    category = "timing"
                elif kw in parsed.get("ability_keywords", []):
                    category = "ability"
                elif kw in parsed.get("don_keywords", []):
                    category = "don"

                await session.run(
                    """
                    MERGE (k:Keyword {name: $name})
                    SET k.category = $category
                    WITH k
                    MATCH (c:Card {id: $card_id})
                    MERGE (c)-[:HAS_KEYWORD]->(k)
                    """,
                    name=kw,
                    category=category,
                    card_id=card_id,
                )
                edges_created += 1

        # Store parsed ability as JSON property on Card node
        for parsed in parsed_results:
            card_id = parsed["card_id"]
            await session.run(
                "MATCH (c:Card {id: $id}) SET c.parsed_ability = $parsed",
                id=card_id,
                parsed=json.dumps(parsed),
            )

    return edges_created
