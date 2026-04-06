"""LLM-based ability text parser — provider-agnostic."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import TYPE_CHECKING

from backend.services.llm_service import (
    LLMNotAvailableError,
    has_any_llm_key,
    llm_complete,
    strip_json_fences,
)
from backend.parser.prompts import ABILITY_PARSER_SYSTEM, ABILITY_PARSER_USER_TEMPLATE
from backend.parser.keywords import get_cost_tier, COST_TIERS
from backend.graph.batch import batch_write, RELATIONSHIP_CHUNK_SIZE

if TYPE_CHECKING:
    from backend.crawlers.tracer import CrawlTracer

logger = logging.getLogger(__name__)

BATCH_SIZE = 40  # Cards per API call (increased from 15 for throughput)
LLM_CONCURRENCY = 3  # Max concurrent LLM calls


async def parse_abilities(
    cards: list[dict],
    batch_size: int = BATCH_SIZE,
    tracer: CrawlTracer | None = None,
    force_regex: bool = False,
) -> list[dict]:
    """Parse ability text for all cards using LLM or regex.

    Args:
        force_regex: If True, always use regex parser (fast, free).
                     Recommended for bulk rebuild operations.

    Returns list of parsed results: [{card_id, timing_keywords, ability_keywords, ...}]
    """
    t0 = time.time()
    use_llm = has_any_llm_key() and not force_regex

    if not use_llm:
        logger.warning("No LLM API key configured, using regex fallback parser")
        if tracer:
            tracer.log("parse_start", method="regex", card_count=len(cards))
        results = [_regex_parse(c) for c in cards]
        if tracer:
            tracer.log(
                "parse_finish",
                method="regex",
                card_count=len(results),
                latency_ms=round((time.time() - t0) * 1000, 1),
            )
        return results

    if tracer:
        tracer.log(
            "parse_start",
            method="llm",
            card_count=len(cards),
            batch_size=batch_size,
            concurrency=LLM_CONCURRENCY,
        )

    results: list[dict] = []

    # Filter cards that have ability text
    cards_with_abilities = [
        c for c in cards if c.get("ability") and c["ability"] != "-"
    ]
    cards_without = [c for c in cards if not c.get("ability") or c["ability"] == "-"]

    # Empty ability cards get empty results
    for c in cards_without:
        results.append(
            {
                "card_id": c["id"],
                "timing_keywords": [],
                "ability_keywords": [],
                "don_keywords": [],
                "effects": [],
                "extracted_keywords": [],
            }
        )

    # Build batches
    batches: list[list[dict]] = []
    for i in range(0, len(cards_with_abilities), batch_size):
        batches.append(cards_with_abilities[i : i + batch_size])

    total_batches = len(batches)
    logger.info(
        f"Parsing {len(cards_with_abilities)} cards in {total_batches} batches "
        f"(size={batch_size}, concurrency={LLM_CONCURRENCY})"
    )

    # Process batches concurrently with semaphore
    sem = asyncio.Semaphore(LLM_CONCURRENCY)
    llm_failures = 0

    async def _parse_with_sem(batch_num: int, batch: list[dict]) -> list[dict]:
        nonlocal llm_failures
        async with sem:
            logger.info(
                f"Parsing batch {batch_num}/{total_batches} ({len(batch)} cards)..."
            )
            bt = time.time()
            parsed = await _parse_batch(batch)
            batch_ms = round((time.time() - bt) * 1000, 1)

            # Check if fell back to regex (parsed won't have LLM-specific fields)
            is_fallback = len(parsed) > 0 and not parsed[0].get("extracted_keywords")
            if is_fallback:
                llm_failures += 1

            if tracer:
                tracer.log(
                    "parse_batch",
                    batch_num=batch_num,
                    total_batches=total_batches,
                    card_count=len(batch),
                    result_count=len(parsed),
                    fallback=is_fallback,
                    latency_ms=batch_ms,
                )
            await asyncio.sleep(0.2)  # Light rate limit
            return parsed

    tasks = [_parse_with_sem(i + 1, batch) for i, batch in enumerate(batches)]
    batch_results = await asyncio.gather(*tasks)

    for parsed in batch_results:
        results.extend(parsed)

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(f"Parsed {len(results)} card abilities ({latency_ms}ms)")
    if tracer:
        tracer.log(
            "parse_finish",
            method="llm",
            card_count=len(results),
            with_abilities=len(cards_with_abilities),
            without_abilities=len(cards_without),
            total_batches=total_batches,
            llm_failures=llm_failures,
            latency_ms=latency_ms,
        )
    return results


async def _parse_batch(batch: list[dict]) -> list[dict]:
    """Parse a batch of cards via the active LLM provider."""
    cards_json = json.dumps(
        [
            {
                "card_id": c["id"],
                "name": c.get("name", ""),
                "ability": c.get("ability", ""),
            }
            for c in batch
        ],
        indent=2,
    )

    user_msg = ABILITY_PARSER_USER_TEMPLATE.format(cards_json=cards_json)

    try:
        text = await llm_complete(ABILITY_PARSER_SYSTEM, user_msg, prefer="smart")
        text = strip_json_fences(text)

        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed

    except LLMNotAvailableError:
        logger.warning("No LLM provider available, falling back to regex")
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
    if (
        re.search(r"play.*from.*hand|play.*character", ability, re.I)
        and "[On Play]" not in ability
    ):
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


async def build_keyword_graph(
    driver,
    parsed_results: list[dict],
    cards: list[dict],
    tracer: CrawlTracer | None = None,
) -> int:
    """Create Keyword nodes, HAS_KEYWORD edges, CostTier nodes, and IN_COST_TIER edges.

    Uses UNWIND batching for high-performance Neo4j writes.
    """
    t0 = time.time()
    if tracer:
        tracer.log(
            "neo4j_start",
            step="build_keyword_graph",
            card_count=len(cards),
            parsed_count=len(parsed_results),
        )

    # --- Precompute all data in Python ---

    # 1. CostTier nodes (small, fixed set)
    tier_params = [
        {"name": t["name"], "range_min": t["range_min"], "range_max": t["range_max"]}
        for t in COST_TIERS
    ]

    # 2. IN_COST_TIER edges
    cost_tier_edges: list[dict] = []
    for card in cards:
        cost = card.get("cost")
        if cost is not None:
            try:
                cost_int = int(cost)
            except (ValueError, TypeError):
                continue
            tier_name = get_cost_tier(cost_int)
            if tier_name:
                cost_tier_edges.append({"card_id": card["id"], "tier": tier_name})

    # 3. Keyword nodes (unique set) and HAS_KEYWORD edges
    keyword_nodes: dict[str, str] = {}  # name -> category
    keyword_edges: list[dict] = []

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

            keyword_nodes[kw] = category
            keyword_edges.append({"card_id": card_id, "keyword": kw})

    kw_node_params = [
        {"name": name, "category": cat} for name, cat in keyword_nodes.items()
    ]

    # 4. Parsed ability JSON updates
    parsed_updates = [
        {"id": p["card_id"], "parsed": json.dumps(p)} for p in parsed_results
    ]

    # --- Batch write to Neo4j ---

    # 1. CostTier nodes
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (t:CostTier {name: row.name})
        SET t.range_min = row.range_min, t.range_max = row.range_max
        """,
        tier_params,
    )

    # 2. IN_COST_TIER edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (c:Card {id: row.card_id})
        MATCH (t:CostTier {name: row.tier})
        MERGE (c)-[:IN_COST_TIER]->(t)
        """,
        cost_tier_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="IN_COST_TIER edges",
    )

    # 3. Keyword nodes (create all unique keywords first)
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MERGE (k:Keyword {name: row.name})
        SET k.category = row.category
        """,
        kw_node_params,
    )

    # 4. HAS_KEYWORD edges
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (c:Card {id: row.card_id})
        MATCH (k:Keyword {name: row.keyword})
        MERGE (c)-[:HAS_KEYWORD]->(k)
        """,
        keyword_edges,
        chunk_size=RELATIONSHIP_CHUNK_SIZE,
        label="HAS_KEYWORD edges",
    )

    # 5. Store parsed ability JSON on Card nodes
    await batch_write(
        driver,
        """
        UNWIND $batch AS row
        MATCH (c:Card {id: row.id})
        SET c.parsed_ability = row.parsed
        """,
        parsed_updates,
        label="Parsed ability updates",
    )

    total_edges = len(cost_tier_edges) + len(keyword_edges)
    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(
        f"Built keyword graph: {len(kw_node_params)} keywords, "
        f"{total_edges} edges, {len(parsed_updates)} parsed updates ({latency_ms}ms)"
    )
    if tracer:
        tracer.log(
            "neo4j_finish",
            step="build_keyword_graph",
            keyword_count=len(kw_node_params),
            cost_tier_edges=len(cost_tier_edges),
            keyword_edges=len(keyword_edges),
            parsed_updates=len(parsed_updates),
            total_edges=total_edges,
            latency_ms=latency_ms,
        )
    return total_edges
