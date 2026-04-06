"""Data management API endpoints."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from neo4j import AsyncDriver

from backend.graph.connection import get_driver
from backend.graph.queries import get_db_stats, get_banned_cards
from backend.storage.redis_client import get_redis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


@router.post("/rebuild")
async def rebuild(background_tasks: BackgroundTasks):
    """Full rebuild pipeline: clean Neo4j → Bandai crawl → price merge → index.

    Single consolidated endpoint that:
    1. Clears all Card/Color/Family/Set/Keyword nodes from Neo4j
    2. Crawls all card data from Bandai official site (51 series)
    3. Downloads card images locally
    4. Merges pricing data from optcgapi
    5. Loads cards into Neo4j
    6. Builds keyword graph + synergy edges
    7. Crawls tournament data (limitlesstcg)
    8. Computes meta stats
    9. Applies ban list
    """
    from backend.crawlers.bandai import crawl_bandai
    from backend.crawlers.optcgapi import crawl_optcgapi
    from backend.crawlers.banned_cards import crawl_banned_cards
    from backend.crawlers.limitlesstcg import crawl_limitlesstcg
    from backend.graph.builder import (
        create_indexes, load_cards, load_tournament_data,
        compute_card_meta_stats, apply_ban_list,
    )
    from backend.graph.connection import get_driver as gd
    from backend.parser.ability_parser import parse_abilities, build_keyword_graph
    from backend.graph.edges import build_all_edges

    async def _run():
        driver = await gd()
        redis = await get_redis()
        now = datetime.now(timezone.utc).isoformat()

        try:
            await _run_pipeline(driver, redis, now)
        except Exception as e:
            logger.error("[Rebuild] FAILED: %s", e, exc_info=True)
            await redis.set("rebuild:status", f"error: {e}")

    async def _run_pipeline(driver, redis, now):
        # Step 1: Clean Neo4j
        logger.info("[Rebuild 1/8] Cleaning Neo4j...")
        async with driver.session() as session:
            await session.run("MATCH (n) WHERE n:Card OR n:Color OR n:Family OR n:Set OR n:Keyword DETACH DELETE n")
        await redis.set("rebuild:status", "cleaning_done")

        # Step 2: Crawl Bandai (cards + images)
        logger.info("[Rebuild 2/8] Crawling Bandai (51 series)...")
        await redis.set("rebuild:status", "crawling_bandai")
        bandai_cards = await crawl_bandai(download_images=True)
        await redis.set("crawl:bandai:last_run", now)
        await redis.set("crawl:bandai:count", str(len(bandai_cards)))
        logger.info("[Rebuild 2/8] Bandai: %d cards", len(bandai_cards))

        # Step 3: Crawl prices from optcgapi
        logger.info("[Rebuild 3/8] Crawling prices from optcgapi...")
        await redis.set("rebuild:status", "crawling_prices")
        try:
            price_cards = await crawl_optcgapi()
            # Merge prices into Bandai cards
            price_map = {c["id"]: c for c in price_cards}
            enriched = 0
            for card in bandai_cards:
                price_data = price_map.get(card["id"])
                if price_data:
                    card["market_price"] = price_data.get("market_price")
                    card["inventory_price"] = price_data.get("inventory_price")
                    enriched += 1
            await redis.set("crawl:optcgapi:last_run", now)
            await redis.set("crawl:optcgapi:count", str(len(price_cards)))
            logger.info("[Rebuild 3/8] Prices: %d cards enriched", enriched)
        except Exception as e:
            logger.warning("[Rebuild 3/8] Price crawl failed (non-fatal): %s", e)

        # Step 4: Load into Neo4j
        logger.info("[Rebuild 4/8] Loading %d cards into Neo4j...", len(bandai_cards))
        await redis.set("rebuild:status", "loading_cards")
        await create_indexes(driver)
        await load_cards(driver, bandai_cards)

        # Step 5: Parse abilities + build keyword graph
        logger.info("[Rebuild 5/8] Parsing abilities + building keyword graph...")
        await redis.set("rebuild:status", "building_keywords")
        parsed = await parse_abilities(bandai_cards)
        await build_keyword_graph(driver, parsed, bandai_cards)

        # Step 6: Build synergy edges
        logger.info("[Rebuild 6/8] Building synergy edges...")
        await redis.set("rebuild:status", "building_edges")
        await build_all_edges(driver)

        # Step 7: Crawl tournament data
        logger.info("[Rebuild 7/8] Crawling tournament data...")
        await redis.set("rebuild:status", "crawling_tournaments")
        try:
            tournament_data = await crawl_limitlesstcg()
            await load_tournament_data(driver, tournament_data)
            await compute_card_meta_stats(driver)
            await redis.set("crawl:limitlesstcg:last_run", now)
            await redis.set("crawl:limitlesstcg:count", str(len(tournament_data.get("decks", []))))
            logger.info("[Rebuild 7/8] Tournaments loaded")
        except Exception as e:
            logger.warning("[Rebuild 7/8] Tournament crawl failed (non-fatal): %s", e)

        # Step 8: Apply ban list
        logger.info("[Rebuild 8/8] Applying ban list...")
        await redis.set("rebuild:status", "applying_bans")
        try:
            banned = await crawl_banned_cards()
            ban_count = await apply_ban_list(driver, banned)
            await redis.set("crawl:banned:last_run", now)
            await redis.set("crawl:banned:count", str(ban_count))
            logger.info("[Rebuild 8/8] %d cards banned", ban_count)
        except Exception as e:
            logger.warning("[Rebuild 8/8] Ban list failed (non-fatal): %s", e)

        await redis.set("rebuild:status", "complete")
        await redis.set("rebuild:last_run", now)
        logger.info("[Rebuild] Complete! %d cards loaded", len(bandai_cards))

    background_tasks.add_task(_run)
    return {"status": "rebuild_started"}


@router.get("/rebuild-status")
async def rebuild_status():
    """Get current rebuild progress."""
    redis = await get_redis()
    status = await redis.get("rebuild:status")
    last_run = await redis.get("rebuild:last_run")
    return {
        "status": status or "idle",
        "last_run": last_run,
    }


@router.get("/crawl-status")
async def crawl_status():
    """Get last crawl timestamps and counts for all sources."""
    r = await get_redis()

    async def _source_status(key: str) -> dict:
        last_run = await r.get(f"crawl:{key}:last_run")
        count = await r.get(f"crawl:{key}:count")
        return {
            "last_run": last_run,
            "count": int(count) if count else 0,
        }

    return {
        "bandai": await _source_status("bandai"),
        "optcgapi": await _source_status("optcgapi"),
        "limitlesstcg": await _source_status("limitlesstcg"),
        "banned": await _source_status("banned"),
    }


@router.get("/banned-cards")
async def banned_cards(driver: AsyncDriver = Depends(_get_driver)):
    """Get list of all banned cards."""
    return await get_banned_cards(driver)


@router.get("/stats")
async def stats(driver: AsyncDriver = Depends(_get_driver)):
    return await get_db_stats(driver)
