"""Crawler for optcgapi.com — secondary source for pricing and images."""

import asyncio
import json
import logging

import httpx

from backend.config import OPTCGAPI_BASE_URL, OPTCGAPI_DELAY, CRAWL_CACHE_DIR
from backend.crawlers.families import parse_families

logger = logging.getLogger(__name__)

CACHE_DIR = CRAWL_CACHE_DIR / "optcgapi"

BULK_ENDPOINTS = [
    "/allSetCards/",
    "/allSTCards/",
    "/allPromoCards/",
    "/allDonCards/",
]


async def crawl_optcgapi() -> list[dict]:
    """Crawl all cards from optcgapi.com bulk endpoints. Returns normalized cards."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    all_cards: list[dict] = []
    seen_ids: set[str] = set()

    async with httpx.AsyncClient(timeout=60) as client:
        for endpoint in BULK_ENDPOINTS:
            url = f"{OPTCGAPI_BASE_URL}{endpoint}"
            logger.info(f"Crawling optcgapi {endpoint}...")

            data = await _fetch_endpoint(client, url)
            if data is None:
                continue

            # Cache raw response
            name = endpoint.strip("/").replace("/", "_")
            cache_file = CACHE_DIR / f"{name}.json"
            cache_file.write_text(json.dumps(data, indent=2))

            raw_cards = data if isinstance(data, list) else []
            for raw in raw_cards:
                card = _normalize(raw)
                if card["id"] and card["id"] not in seen_ids:
                    all_cards.append(card)
                    seen_ids.add(card["id"])

            logger.info(f"  Got {len(raw_cards)} cards from {endpoint}")
            await asyncio.sleep(OPTCGAPI_DELAY)

    logger.info(f"optcgapi crawl complete: {len(all_cards)} cards")
    return all_cards


async def _fetch_endpoint(
    client: httpx.AsyncClient, url: str, retries: int = 3
) -> list | dict | None:
    """Fetch endpoint with retry."""
    for attempt in range(retries):
        try:
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.json()
            wait = 5 * (attempt + 1)
            logger.warning(f"  HTTP {resp.status_code} for {url}, retrying in {wait}s...")
            await asyncio.sleep(wait)
        except httpx.RequestError as e:
            wait = 5 * (attempt + 1)
            logger.warning(f"  Request error for {url}: {e}, retrying in {wait}s...")
            await asyncio.sleep(wait)
    logger.error(f"  Failed to fetch {url} after {retries} retries")
    return None


def _normalize(raw: dict) -> dict:
    """Normalize optcgapi card to unified format."""
    card_id = raw.get("card_set_id", "")

    # Extract set_id from card_id, e.g. "OP03-070" → "OP03"
    set_id = ""
    if "-" in card_id:
        set_id = card_id.rsplit("-", 1)[0]

    return {
        "id": card_id,
        "code": card_id,
        "name": raw.get("card_name", ""),
        "card_type": (raw.get("card_type", "") or "").upper(),
        "cost": raw.get("card_cost"),
        "power": raw.get("card_power"),
        "counter": raw.get("counter_amount"),
        "rarity": raw.get("rarity", ""),
        "attribute": raw.get("attribute", ""),
        "color": raw.get("card_color", ""),
        "family": "/".join(parse_families(raw.get("sub_types", "") or "")),
        "ability": raw.get("card_text", ""),
        "trigger_effect": "",
        "image_small": raw.get("card_image", ""),
        "image_large": raw.get("card_image", ""),
        "set_id": set_id,
        "set_name": raw.get("set_name", ""),
        "life": raw.get("life", ""),
        "inventory_price": raw.get("inventory_price"),
        "market_price": raw.get("market_price"),
        "source_apitcg": False,
        "source_optcgapi": True,
    }
