"""Crawler for apitcg.com — primary source for card mechanics."""

import asyncio
import json
import logging

import httpx

from backend.config import APITCG_BASE_URL, APITCG_DELAY, CRAWL_CACHE_DIR
from backend.services.settings_service import get_active_api_key

logger = logging.getLogger(__name__)

CACHE_DIR = CRAWL_CACHE_DIR / "apitcg"


def _get_api_key() -> str:
    """Get ApiTCG API key from Redis-persisted runtime keys."""
    return get_active_api_key("apitcg")


async def crawl_apitcg() -> list[dict]:
    """Crawl all cards from apitcg.com. Returns list of normalized card dicts."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    all_cards: list[dict] = []
    page = 1

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        while True:
            logger.info(f"Crawling apitcg page {page}...")
            data = await _fetch_page(client, page)

            if data is None:
                break

            raw_cards = data.get("data", [])
            if not raw_cards:
                break

            # Cache raw response
            cache_file = CACHE_DIR / f"page_{page}.json"
            cache_file.write_text(json.dumps(data, indent=2))

            for raw in raw_cards:
                all_cards.append(_normalize(raw))

            total_pages = data.get("totalPages", 1)
            logger.info(f"  Got {len(raw_cards)} cards (page {page}/{total_pages})")

            if page >= total_pages:
                break

            page += 1
            await asyncio.sleep(APITCG_DELAY)

    logger.info(f"apitcg crawl complete: {len(all_cards)} cards")
    return all_cards


async def _fetch_page(client: httpx.AsyncClient, page: int, retries: int = 3) -> dict | None:
    """Fetch a single page with retry and exponential backoff."""
    for attempt in range(retries):
        try:
            resp = await client.get(
                APITCG_BASE_URL,
                params={"page": page},
                headers={"Authorization": f"Bearer {_get_api_key()}"},
            )
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 500, 502, 503):
                wait = (2 ** attempt) * 2
                logger.warning(f"  HTTP {resp.status_code}, retrying in {wait}s...")
                await asyncio.sleep(wait)
                continue
            logger.error(f"  HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        except httpx.RequestError as e:
            wait = (2 ** attempt) * 2
            logger.warning(f"  Request error: {e}, retrying in {wait}s...")
            await asyncio.sleep(wait)
    return None


def _normalize(raw: dict) -> dict:
    """Normalize apitcg card to unified format."""
    images = raw.get("images", {}) or {}
    set_info = raw.get("set", {}) or {}
    set_name = set_info.get("name", "")

    # Extract set ID from set name, e.g. "-PILLARS OF STRENGTH- [OP03]" → "OP03"
    set_id = ""
    if "[" in set_name and "]" in set_name:
        set_id = set_name.split("[")[-1].rstrip("]").strip()

    attribute = raw.get("attribute", "")
    if isinstance(attribute, dict):
        attribute = attribute.get("name", "")

    return {
        "id": raw.get("id", ""),
        "code": raw.get("code", raw.get("id", "")),
        "name": raw.get("name", ""),
        "card_type": (raw.get("type", "") or "").upper(),
        "cost": raw.get("cost"),
        "power": raw.get("power"),
        "counter": raw.get("counter"),
        "rarity": raw.get("rarity", ""),
        "attribute": attribute,
        "color": raw.get("color", ""),
        "family": raw.get("family", ""),
        "ability": raw.get("ability", ""),
        "trigger_effect": raw.get("trigger", ""),
        "image_small": images.get("small", ""),
        "image_large": images.get("large", ""),
        "set_id": set_id,
        "set_name": set_name.strip("-[] "),
        "life": "",
        "inventory_price": None,
        "market_price": None,
        "source_apitcg": True,
        "source_optcgapi": False,
    }
