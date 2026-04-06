"""Data management API endpoints.

Rebuild pipeline split into 3 independent steps:
  1. Clean — delete all Neo4j nodes
  2. Crawl — Bandai crawl + price merge + load into Neo4j + parse keywords
  3. Index — build synergy edges + tournament data + ban list
"""

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


# ---------------------------------------------------------------------------
# Step 1: Clean Neo4j
# ---------------------------------------------------------------------------

@router.post("/step/clean")
async def step_clean(background_tasks: BackgroundTasks):
    """Delete all card-related nodes from Neo4j (batched to avoid memory overflow)."""
    from backend.graph.connection import get_driver as gd

    async def _run():
        redis = await get_redis()
        try:
            await redis.set("rebuild:step:clean", "running")
            driver = await gd()

            for label in ["Card", "Keyword", "Family", "Color", "Set", "CostTier", "Deck", "Tournament"]:
                deleted = 1
                while deleted > 0:
                    async with driver.session() as session:
                        result = await session.run(
                            f"MATCH (n:{label}) WITH n LIMIT 500 DETACH DELETE n RETURN count(*) AS cnt"
                        )
                        rec = await result.single()
                        deleted = rec["cnt"] if rec else 0
                    if deleted > 0:
                        logger.info("[Clean] Deleted %d %s nodes", deleted, label)

            await redis.set("rebuild:step:clean", "done")
            logger.info("[Clean] Complete")
        except Exception as e:
            logger.error("[Clean] FAILED: %s", e, exc_info=True)
            await redis.set("rebuild:step:clean", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "clean_started"}


# ---------------------------------------------------------------------------
# Step 2: Crawl + Load
# ---------------------------------------------------------------------------

@router.post("/step/crawl")
async def step_crawl(background_tasks: BackgroundTasks):
    """Crawl Bandai (cards + images), merge prices, load into Neo4j, parse keywords."""
    from backend.crawlers.bandai import crawl_bandai
    from backend.crawlers.optcgapi import crawl_optcgapi
    from backend.graph.builder import create_indexes, load_cards
    from backend.graph.connection import get_driver as gd
    from backend.parser.ability_parser import parse_abilities, build_keyword_graph

    async def _run():
        redis = await get_redis()
        try:
            now = datetime.now(timezone.utc).isoformat()
            driver = await gd()

            # Crawl Bandai
            await redis.set("rebuild:step:crawl", "crawling_bandai")
            logger.info("[Crawl] Crawling Bandai (51 series)...")
            bandai_cards = await crawl_bandai(download_images=True)
            await redis.set("crawl:bandai:last_run", now)
            await redis.set("crawl:bandai:count", str(len(bandai_cards)))
            logger.info("[Crawl] Bandai: %d cards", len(bandai_cards))

            # Merge prices
            await redis.set("rebuild:step:crawl", "crawling_prices")
            logger.info("[Crawl] Crawling prices from optcgapi...")
            try:
                price_cards = await crawl_optcgapi()
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
                logger.info("[Crawl] Prices: %d cards enriched", enriched)
            except Exception as e:
                logger.warning("[Crawl] Price crawl failed (non-fatal): %s", e)

            # Load into Neo4j
            await redis.set("rebuild:step:crawl", "loading_cards")
            logger.info("[Crawl] Loading %d cards into Neo4j...", len(bandai_cards))
            await create_indexes(driver)
            await load_cards(driver, bandai_cards)

            # Parse abilities + keyword graph
            await redis.set("rebuild:step:crawl", "building_keywords")
            logger.info("[Crawl] Parsing abilities + building keywords...")
            parsed = await parse_abilities(bandai_cards, force_regex=True)
            await build_keyword_graph(driver, parsed, bandai_cards)

            await redis.set("rebuild:step:crawl", "done")
            logger.info("[Crawl] Complete — %d cards loaded", len(bandai_cards))
        except Exception as e:
            logger.error("[Crawl] FAILED: %s", e, exc_info=True)
            await redis.set("rebuild:step:crawl", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "crawl_started"}


# ---------------------------------------------------------------------------
# Step 3: Build Index (edges + tournaments + bans)
# ---------------------------------------------------------------------------

@router.post("/step/index")
async def step_index(background_tasks: BackgroundTasks):
    """Build synergy edges, load tournament data, apply ban list."""
    from backend.crawlers.limitlesstcg import crawl_limitlesstcg
    from backend.crawlers.banned_cards import crawl_banned_cards
    from backend.graph.builder import load_tournament_data, compute_card_meta_stats, apply_ban_list
    from backend.graph.connection import get_driver as gd
    from backend.graph.edges import build_all_edges

    async def _run():
        redis = await get_redis()
        try:
            now = datetime.now(timezone.utc).isoformat()
            driver = await gd()

            # Build synergy edges (batched to avoid memory overflow)
            await redis.set("rebuild:step:index", "building_edges")
            logger.info("[Index] Building synergy edges (batched)...")
            await build_all_edges(driver)

            # Tournament data
            await redis.set("rebuild:step:index", "crawling_tournaments")
            logger.info("[Index] Crawling tournament data...")
            try:
                tournament_data = await crawl_limitlesstcg()
                await load_tournament_data(driver, tournament_data)
                await compute_card_meta_stats(driver)
                await redis.set("crawl:limitlesstcg:last_run", now)
                await redis.set("crawl:limitlesstcg:count", str(len(tournament_data.get("decks", []))))
                logger.info("[Index] Tournaments loaded")
            except Exception as e:
                logger.warning("[Index] Tournament crawl failed (non-fatal): %s", e)

            # Ban list
            await redis.set("rebuild:step:index", "applying_bans")
            logger.info("[Index] Applying ban list...")
            try:
                banned = await crawl_banned_cards()
                ban_count = await apply_ban_list(driver, banned)
                await redis.set("crawl:banned:last_run", now)
                await redis.set("crawl:banned:count", str(ban_count))
                logger.info("[Index] %d cards banned", ban_count)
            except Exception as e:
                logger.warning("[Index] Ban list failed (non-fatal): %s", e)

            await redis.set("rebuild:step:index", "done")
            await redis.set("rebuild:last_run", now)
            logger.info("[Index] Complete")
        except Exception as e:
            logger.error("[Index] FAILED: %s", e, exc_info=True)
            await redis.set("rebuild:step:index", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "index_started"}


# ---------------------------------------------------------------------------
# Full Rebuild (convenience — runs all 3 steps)
# ---------------------------------------------------------------------------

@router.post("/rebuild")
async def rebuild(background_tasks: BackgroundTasks):
    """Run all 3 steps in sequence: clean → crawl → index."""

    async def _run():
        redis = await get_redis()
        try:
            await redis.set("rebuild:status", "running")

            # Step 1: Clean
            await redis.set("rebuild:status", "cleaning")
            await _run_clean()

            # Step 2: Crawl
            await redis.set("rebuild:status", "crawling")
            await _run_crawl()

            # Step 3: Index
            await redis.set("rebuild:status", "indexing")
            await _run_index()

            await redis.set("rebuild:status", "complete")
            await redis.set("rebuild:last_run", datetime.now(timezone.utc).isoformat())
        except Exception as e:
            logger.error("[Rebuild] FAILED: %s", e, exc_info=True)
            await redis.set("rebuild:status", f"error: {e}")

    async def _run_clean():
        from backend.graph.connection import get_driver as gd
        driver = await gd()
        for label in ["Card", "Keyword", "Family", "Color", "Set", "CostTier", "Deck", "Tournament"]:
            deleted = 1
            while deleted > 0:
                async with driver.session() as session:
                    result = await session.run(
                        f"MATCH (n:{label}) WITH n LIMIT 500 DETACH DELETE n RETURN count(*) AS cnt"
                    )
                    rec = await result.single()
                    deleted = rec["cnt"] if rec else 0

    async def _run_crawl():
        from backend.crawlers.bandai import crawl_bandai
        from backend.crawlers.optcgapi import crawl_optcgapi
        from backend.graph.builder import create_indexes, load_cards
        from backend.graph.connection import get_driver as gd
        from backend.parser.ability_parser import parse_abilities, build_keyword_graph

        redis = await get_redis()
        now = datetime.now(timezone.utc).isoformat()
        driver = await gd()

        bandai_cards = await crawl_bandai(download_images=True)
        await redis.set("crawl:bandai:last_run", now)
        await redis.set("crawl:bandai:count", str(len(bandai_cards)))

        try:
            price_cards = await crawl_optcgapi()
            price_map = {c["id"]: c for c in price_cards}
            for card in bandai_cards:
                p = price_map.get(card["id"])
                if p:
                    card["market_price"] = p.get("market_price")
                    card["inventory_price"] = p.get("inventory_price")
            await redis.set("crawl:optcgapi:last_run", now)
            await redis.set("crawl:optcgapi:count", str(len(price_cards)))
        except Exception as e:
            logger.warning("[Rebuild] Price crawl failed: %s", e)

        await create_indexes(driver)
        await load_cards(driver, bandai_cards)
        parsed = await parse_abilities(bandai_cards, force_regex=True)
        await build_keyword_graph(driver, parsed, bandai_cards)

    async def _run_index():
        from backend.crawlers.limitlesstcg import crawl_limitlesstcg
        from backend.crawlers.banned_cards import crawl_banned_cards
        from backend.graph.builder import load_tournament_data, compute_card_meta_stats, apply_ban_list
        from backend.graph.connection import get_driver as gd
        from backend.graph.edges import build_all_edges

        redis = await get_redis()
        now = datetime.now(timezone.utc).isoformat()
        driver = await gd()

        await build_all_edges(driver)

        try:
            tournament_data = await crawl_limitlesstcg()
            await load_tournament_data(driver, tournament_data)
            await compute_card_meta_stats(driver)
            await redis.set("crawl:limitlesstcg:last_run", now)
            await redis.set("crawl:limitlesstcg:count", str(len(tournament_data.get("decks", []))))
        except Exception as e:
            logger.warning("[Rebuild] Tournament crawl failed: %s", e)

        try:
            banned = await crawl_banned_cards()
            await apply_ban_list(driver, banned)
            await redis.set("crawl:banned:last_run", now)
        except Exception as e:
            logger.warning("[Rebuild] Ban list failed: %s", e)

    background_tasks.add_task(_run)
    return {"status": "rebuild_started"}


# ---------------------------------------------------------------------------
# Status endpoints
# ---------------------------------------------------------------------------

@router.get("/rebuild-status")
async def rebuild_status():
    """Get rebuild and step statuses."""
    redis = await get_redis()
    status = await redis.get("rebuild:status")
    last_run = await redis.get("rebuild:last_run")
    clean = await redis.get("rebuild:step:clean")
    crawl = await redis.get("rebuild:step:crawl")
    index = await redis.get("rebuild:step:index")
    return {
        "status": status or "idle",
        "last_run": last_run,
        "steps": {
            "clean": clean or "idle",
            "crawl": crawl or "idle",
            "index": index or "idle",
        },
    }


@router.post("/rebuild-stop")
async def rebuild_stop():
    """Force-reset all rebuild/step statuses to idle."""
    redis = await get_redis()
    await redis.set("rebuild:status", "idle")
    await redis.set("rebuild:step:clean", "idle")
    await redis.set("rebuild:step:crawl", "idle")
    await redis.set("rebuild:step:index", "idle")
    logger.info("[Rebuild] Force-stopped by user")
    return {"status": "stopped"}


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
