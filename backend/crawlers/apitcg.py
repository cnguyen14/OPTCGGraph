"""Crawler for apitcg.com — primary source for card mechanics."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING

import httpx

from backend.config import APITCG_BASE_URL, APITCG_DELAY, CRAWL_CACHE_DIR
from backend.services.settings_service import get_active_api_key

if TYPE_CHECKING:
    from backend.crawlers.tracer import CrawlTracer

logger = logging.getLogger(__name__)

CACHE_DIR = CRAWL_CACHE_DIR / "apitcg"


def _get_api_key() -> str:
    """Get ApiTCG API key from Redis-persisted runtime keys."""
    return get_active_api_key("apitcg")


async def crawl_apitcg(tracer: CrawlTracer | None = None) -> list[dict]:
    """Crawl all cards from apitcg.com with concurrent page fetching.

    Returns list of normalized card dicts.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    all_cards: list[dict] = []
    t0 = time.time()

    if tracer:
        tracer.log("crawl_start", source="apitcg")

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # Phase 1: Fetch first page to discover totalPages
        logger.info("Crawling apitcg page 1...")
        first_data = await _fetch_page(client, 1)
        if first_data is None:
            if tracer:
                tracer.log(
                    "crawl_error", source="apitcg", message="First page returned None"
                )
            return []

        raw_cards = first_data.get("data", [])
        if not raw_cards:
            return []

        # Cache and collect first page
        (CACHE_DIR / "page_1.json").write_text(json.dumps(first_data, indent=2))
        for raw in raw_cards:
            all_cards.append(_normalize(raw))

        total_pages = first_data.get("totalPages", 1)
        logger.info(f"  Got {len(raw_cards)} cards (page 1/{total_pages})")
        if tracer:
            tracer.log(
                "page_fetched",
                source="apitcg",
                page=1,
                total_pages=total_pages,
                card_count=len(raw_cards),
            )

        if total_pages <= 1:
            latency_ms = round((time.time() - t0) * 1000, 1)
            logger.info(f"apitcg crawl complete: {len(all_cards)} cards")
            if tracer:
                tracer.log(
                    "crawl_finish",
                    source="apitcg",
                    total_cards=len(all_cards),
                    total_pages=1,
                    latency_ms=latency_ms,
                )
            return all_cards

        # Phase 2: Fetch remaining pages concurrently with semaphore
        sem = asyncio.Semaphore(3)
        failed_pages: list[int] = []

        async def _fetch_with_sem(page: int) -> tuple[int, dict | None]:
            async with sem:
                await asyncio.sleep(APITCG_DELAY)
                pt = time.time()
                data = await _fetch_page(client, page)
                page_ms = round((time.time() - pt) * 1000, 1)
                if tracer:
                    card_count = len(data.get("data", [])) if data else 0
                    tracer.log(
                        "page_fetched",
                        source="apitcg",
                        page=page,
                        total_pages=total_pages,
                        card_count=card_count,
                        latency_ms=page_ms,
                        ok=data is not None,
                    )
                if data is None:
                    failed_pages.append(page)
                return (page, data)

        tasks = [_fetch_with_sem(p) for p in range(2, total_pages + 1)]
        results = await asyncio.gather(*tasks)

        # Process results in page order
        for page_num, data in sorted(results, key=lambda r: r[0]):
            if data is None:
                continue
            raw_cards = data.get("data", [])
            if not raw_cards:
                continue

            # Cache raw response
            cache_file = CACHE_DIR / f"page_{page_num}.json"
            cache_file.write_text(json.dumps(data, indent=2))

            for raw in raw_cards:
                all_cards.append(_normalize(raw))

            logger.info(f"  Got {len(raw_cards)} cards (page {page_num}/{total_pages})")

    latency_ms = round((time.time() - t0) * 1000, 1)
    logger.info(f"apitcg crawl complete: {len(all_cards)} cards")
    if tracer:
        tracer.log(
            "crawl_finish",
            source="apitcg",
            total_cards=len(all_cards),
            total_pages=total_pages,
            failed_pages=failed_pages,
            latency_ms=latency_ms,
        )
    return all_cards


async def _fetch_page(
    client: httpx.AsyncClient, page: int, retries: int = 3
) -> dict | None:
    """Fetch a single page with retry and exponential backoff."""
    for attempt in range(retries):
        try:
            resp = await client.get(
                APITCG_BASE_URL,
                params={"page": page},
                headers={"x-api-key": _get_api_key()},
            )
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 500, 502, 503):
                wait = (2**attempt) * 2
                logger.warning(f"  HTTP {resp.status_code}, retrying in {wait}s...")
                await asyncio.sleep(wait)
                continue
            logger.error(f"  HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        except httpx.RequestError as e:
            wait = (2**attempt) * 2
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
