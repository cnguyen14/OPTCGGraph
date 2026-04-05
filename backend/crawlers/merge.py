"""Merge card data from apitcg and optcgapi sources."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.crawlers.tracer import CrawlTracer

logger = logging.getLogger(__name__)

# Fields where apitcg is primary (game mechanics)
APITCG_PRIMARY_FIELDS = {
    "name",
    "card_type",
    "cost",
    "power",
    "counter",
    "rarity",
    "attribute",
    "color",
    "family",
    "ability",
    "trigger_effect",
}

# Fields where optcgapi is primary (pricing + images)
OPTCGAPI_PRIMARY_FIELDS = {
    "market_price",
    "inventory_price",
    "image_small",
    "image_large",
    "life",
}


def merge_cards(
    apitcg_cards: list[dict],
    optcgapi_cards: list[dict],
    tracer: CrawlTracer | None = None,
) -> list[dict]:
    """Merge cards from both sources. Returns unified card list.

    - Join key: card ID
    - apitcg is primary for game mechanics
    - optcgapi is primary for pricing and images
    - Cards from only one source are included as-is
    """
    t0 = time.time()
    apitcg_map = {c["id"]: c for c in apitcg_cards if c.get("id")}
    optcgapi_map = {c["id"]: c for c in optcgapi_cards if c.get("id")}

    all_ids = set(apitcg_map.keys()) | set(optcgapi_map.keys())
    merged: list[dict] = []

    both = 0
    apitcg_only = 0
    optcgapi_only = 0

    for card_id in sorted(all_ids):
        a = apitcg_map.get(card_id)
        o = optcgapi_map.get(card_id)

        if a and o:
            # Merge: start with apitcg, overlay optcgapi for its primary fields
            card = dict(a)
            for field in OPTCGAPI_PRIMARY_FIELDS:
                val = o.get(field)
                if val is not None and val != "" and val != "-":
                    card[field] = val
            card["source_apitcg"] = True
            card["source_optcgapi"] = True
            # Use optcgapi set_name if apitcg is empty
            if not card.get("set_name") and o.get("set_name"):
                card["set_name"] = o["set_name"]
            both += 1
        elif a:
            card = dict(a)
            apitcg_only += 1
        else:
            card = dict(o)  # type: ignore[arg-type]
            optcgapi_only += 1

        merged.append(card)

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(
        f"Merge complete: {len(merged)} total "
        f"(both: {both}, apitcg-only: {apitcg_only}, optcgapi-only: {optcgapi_only})"
    )
    if tracer:
        tracer.log(
            "merge_finish",
            total=len(merged),
            both=both,
            apitcg_only=apitcg_only,
            optcgapi_only=optcgapi_only,
            latency_ms=latency_ms,
        )
    return merged
