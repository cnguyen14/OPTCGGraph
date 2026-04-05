"""Crawler for official OPTCG banned/restricted card list from Bandai."""

import json
import logging
import re
from datetime import datetime, timezone

import httpx

from backend.config import CRAWL_CACHE_DIR

logger = logging.getLogger(__name__)

BANDAI_BANLIST_URL = "https://en.onepiece-cardgame.com/topics/029.php"

# Card code pattern: 2-4 uppercase letters + optional digits, dash, 3 digits
CARD_CODE_PATTERN = re.compile(r"\b([A-Z]{2,4}\d{0,2}-\d{3})\b")

# Hardcoded fallback — known banned cards as of March 2025
# These serve as a baseline if scraping fails
FALLBACK_BANNED_CARDS = [
    {"card_id": "OP03-099", "status": "banned", "reason": "Officially banned by Bandai"},
    {"card_id": "OP05-074", "status": "banned", "reason": "Officially banned by Bandai"},
    {"card_id": "OP06-086", "status": "banned", "reason": "Officially banned by Bandai"},
    {"card_id": "P-048", "status": "banned", "reason": "Officially banned by Bandai"},
]

CACHE_DIR = CRAWL_CACHE_DIR / "banned"


async def crawl_banned_cards(use_cache: bool = False) -> list[dict]:
    """Fetch the official banned card list from Bandai.

    Returns list of dicts with: card_id, status, reason, effective_date
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / "banned_list.json"

    if use_cache and cache_file.exists():
        logger.info("Loading banned cards from cache")
        data = json.loads(cache_file.read_text())
        return data.get("cards", [])

    try:
        banned_cards = await _scrape_banlist()
        if not banned_cards:
            logger.warning("Scrape returned empty, using fallback banned list")
            banned_cards = FALLBACK_BANNED_CARDS

        # Cache results
        cache_data = {
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "source": BANDAI_BANLIST_URL,
            "count": len(banned_cards),
            "cards": banned_cards,
        }
        cache_file.write_text(json.dumps(cache_data, indent=2))
        logger.info(f"Cached {len(banned_cards)} banned cards")

        return banned_cards

    except Exception as e:
        logger.error(f"Failed to scrape ban list: {e}")
        # Try cache first, then fallback
        if cache_file.exists():
            logger.info("Using cached banned cards after scrape failure")
            data = json.loads(cache_file.read_text())
            return data.get("cards", [])
        logger.warning("No cache available, using fallback banned list")
        return FALLBACK_BANNED_CARDS


async def _scrape_banlist() -> list[dict]:
    """Scrape the Bandai ban list page for card codes."""
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(BANDAI_BANLIST_URL, headers={
            "User-Agent": "Mozilla/5.0 (OPTCG Knowledge Graph; card data research)"
        })
        resp.raise_for_status()
        html = resp.text

    # Extract card codes from the HTML
    card_codes = CARD_CODE_PATTERN.findall(html)
    if not card_codes:
        logger.warning("No card codes found in ban list HTML")
        return []

    # Deduplicate while preserving order
    seen = set()
    unique_codes = []
    for code in card_codes:
        if code not in seen:
            seen.add(code)
            unique_codes.append(code)

    banned_cards = []
    for code in unique_codes:
        banned_cards.append({
            "card_id": code,
            "status": "banned",
            "reason": "Officially banned by Bandai",
        })

    logger.info(f"Scraped {len(banned_cards)} banned cards from Bandai")
    return banned_cards
