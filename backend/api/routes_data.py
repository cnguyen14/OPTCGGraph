"""Data management API — 6 independent pipeline steps.

Each step can be run independently and retried on failure:
  1. Clean       — delete all Neo4j nodes
  2. Bandai      — crawl cards + images from Bandai official
  3. Prices      — update prices from optcgapi
  4. Banned      — update banned card list
  5. Tournaments — crawl tournament decks from LimitlessTCG
  6. Index       — build synergy edges + keyword graph
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from neo4j import AsyncDriver

from backend.api.deps import verify_admin_token
from backend.graph.connection import get_driver
from backend.graph.queries import get_banned_cards, get_db_stats
from backend.storage.redis_client import get_redis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])

STEP_NAMES = ["clean", "bandai", "prices", "banned", "tournaments", "index"]


async def _get_driver() -> AsyncDriver:
    return await get_driver()


async def _set_step(name: str, status: str) -> None:
    redis = await get_redis()
    await redis.set(f"rebuild:step:{name}", status)


# ---------------------------------------------------------------------------
# Step 1: Clean Neo4j
# ---------------------------------------------------------------------------


@router.post("/step/clean", dependencies=[Depends(verify_admin_token)])
async def step_clean(background_tasks: BackgroundTasks):
    """Delete all card-related nodes from Neo4j (batched)."""
    from backend.graph.connection import get_driver as gd

    async def _run():
        try:
            await _set_step("clean", "running")
            driver = await gd()
            for label in [
                "Card",
                "Keyword",
                "Family",
                "Color",
                "Set",
                "CostTier",
                "Deck",
                "Tournament",
            ]:
                deleted = 1
                while deleted > 0:
                    async with driver.session() as session:
                        result = await session.run(
                            f"MATCH (n:{label}) WITH n LIMIT 500 DETACH DELETE n RETURN count(*) AS cnt"
                        )
                        rec = await result.single()
                        deleted = rec["cnt"] if rec else 0
            await _set_step("clean", "done")
            logger.info("[Clean] Complete")
        except Exception as e:
            logger.error("[Clean] FAILED: %s", e, exc_info=True)
            await _set_step("clean", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "clean_started"}


# ---------------------------------------------------------------------------
# Step 2: Crawl Bandai (cards + images)
# ---------------------------------------------------------------------------


@router.post("/step/bandai", dependencies=[Depends(verify_admin_token)])
async def step_bandai(background_tasks: BackgroundTasks):
    """Crawl card data + images from Bandai official site. Load into Neo4j."""
    from backend.crawlers.bandai import crawl_bandai
    from backend.graph.builder import create_indexes, load_cards
    from backend.graph.connection import get_driver as gd
    from backend.parser.ability_parser import build_keyword_graph, parse_abilities

    async def _run():
        try:
            await _set_step("bandai", "crawling")
            now = datetime.now(timezone.utc).isoformat()
            driver = await gd()

            cards = await crawl_bandai(download_images=True)
            redis = await get_redis()
            await redis.set("crawl:bandai:last_run", now)
            await redis.set("crawl:bandai:count", str(len(cards)))

            await _set_step("bandai", "loading")
            await create_indexes(driver)
            await load_cards(driver, cards)

            await _set_step("bandai", "parsing_keywords")
            parsed = await parse_abilities(cards, force_regex=True)
            await build_keyword_graph(driver, parsed, cards)

            await _set_step("bandai", "done")
            logger.info("[Bandai] Complete — %d cards", len(cards))
        except Exception as e:
            logger.error("[Bandai] FAILED: %s", e, exc_info=True)
            await _set_step("bandai", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "bandai_started"}


# ---------------------------------------------------------------------------
# Step 3: Update Prices (optcgapi)
# ---------------------------------------------------------------------------


@router.post("/step/prices", dependencies=[Depends(verify_admin_token)])
async def step_prices(background_tasks: BackgroundTasks):
    """Update card prices from optcgapi. Only updates existing cards in Neo4j."""
    from backend.crawlers.optcgapi import crawl_optcgapi
    from backend.graph.connection import get_driver as gd

    async def _run():
        try:
            await _set_step("prices", "crawling")
            now = datetime.now(timezone.utc).isoformat()
            driver = await gd()

            price_cards = await crawl_optcgapi()
            count = 0
            async with driver.session() as session:
                for card in price_cards:
                    mp = card.get("market_price")
                    ip = card.get("inventory_price")
                    if mp is not None or ip is not None:
                        await session.run(
                            "MATCH (c:Card {id: $id}) "
                            "SET c.market_price = $mp, c.inventory_price = $ip",
                            id=card["id"],
                            mp=mp,
                            ip=ip,
                        )
                        count += 1

            redis = await get_redis()
            await redis.set("crawl:optcgapi:last_run", now)
            await redis.set("crawl:optcgapi:count", str(count))
            await _set_step("prices", "done")
            logger.info("[Prices] Complete — %d cards updated", count)
        except Exception as e:
            logger.error("[Prices] FAILED: %s", e, exc_info=True)
            await _set_step("prices", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "prices_started"}


# ---------------------------------------------------------------------------
# Step 4: Update Banned Cards
# ---------------------------------------------------------------------------


@router.post("/step/banned", dependencies=[Depends(verify_admin_token)])
async def step_banned(background_tasks: BackgroundTasks):
    """Crawl and apply official banned card list."""
    from backend.crawlers.banned_cards import crawl_banned_cards
    from backend.graph.builder import apply_ban_list
    from backend.graph.connection import get_driver as gd

    async def _run():
        try:
            await _set_step("banned", "crawling")
            now = datetime.now(timezone.utc).isoformat()
            driver = await gd()

            banned = await crawl_banned_cards()
            ban_count = await apply_ban_list(driver, banned)

            redis = await get_redis()
            await redis.set("crawl:banned:last_run", now)
            await redis.set("crawl:banned:count", str(ban_count))
            await _set_step("banned", "done")
            logger.info("[Banned] Complete — %d cards banned", ban_count)
        except Exception as e:
            logger.error("[Banned] FAILED: %s", e, exc_info=True)
            await _set_step("banned", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "banned_started"}


# ---------------------------------------------------------------------------
# Step 5: Load Tournament Decks
# ---------------------------------------------------------------------------


@router.post("/step/tournaments", dependencies=[Depends(verify_admin_token)])
async def step_tournaments(background_tasks: BackgroundTasks):
    """Crawl tournament data from LimitlessTCG and compute meta stats."""
    from backend.crawlers.limitlesstcg import crawl_limitlesstcg
    from backend.graph.builder import compute_card_meta_stats, load_tournament_data
    from backend.graph.connection import get_driver as gd

    async def _run():
        try:
            await _set_step("tournaments", "crawling")
            now = datetime.now(timezone.utc).isoformat()
            driver = await gd()

            data = await crawl_limitlesstcg()
            await _set_step("tournaments", "loading")
            await load_tournament_data(
                driver,
                data.get("tournaments", []),
                data.get("decks", []),
            )
            await _set_step("tournaments", "computing_stats")
            await compute_card_meta_stats(driver)

            redis = await get_redis()
            await redis.set("crawl:limitlesstcg:last_run", now)
            await redis.set("crawl:limitlesstcg:count", str(len(data.get("decks", []))))
            await _set_step("tournaments", "done")
            logger.info("[Tournaments] Complete — %d decks", len(data.get("decks", [])))
        except Exception as e:
            logger.error("[Tournaments] FAILED: %s", e, exc_info=True)
            await _set_step("tournaments", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "tournaments_started"}


# ---------------------------------------------------------------------------
# Step 6: Build Index (synergy edges)
# ---------------------------------------------------------------------------


@router.post("/step/index", dependencies=[Depends(verify_admin_token)])
async def step_index(background_tasks: BackgroundTasks):
    """Build synergy, mechanical synergy, curves_into, and led_by edges."""
    from backend.graph.connection import get_driver as gd
    from backend.graph.edges import build_all_edges

    async def _run():
        try:
            await _set_step("index", "building_edges")
            driver = await gd()
            await build_all_edges(driver)
            await _set_step("index", "done")
            logger.info("[Index] Complete")
        except Exception as e:
            logger.error("[Index] FAILED: %s", e, exc_info=True)
            await _set_step("index", f"error: {e}")

    background_tasks.add_task(_run)
    return {"status": "index_started"}


# ---------------------------------------------------------------------------
# Status + Stop
# ---------------------------------------------------------------------------


@router.get("/rebuild-status")
async def rebuild_status():
    """Get all step statuses."""
    redis = await get_redis()
    last_run = await redis.get("rebuild:last_run")
    steps = {}
    for name in STEP_NAMES:
        val = await redis.get(f"rebuild:step:{name}")
        steps[name] = val or "idle"
    return {"status": "idle", "last_run": last_run, "steps": steps}


@router.post("/rebuild-stop")
async def rebuild_stop():
    """Force-reset all step statuses to idle."""
    redis = await get_redis()
    for name in STEP_NAMES:
        await redis.set(f"rebuild:step:{name}", "idle")
    logger.info("[Stop] All steps reset to idle")
    return {"status": "stopped"}


@router.get("/crawl-status")
async def crawl_status():
    """Get last crawl timestamps and counts for all sources."""
    r = await get_redis()

    async def _source_status(key: str) -> dict:
        last_run = await r.get(f"crawl:{key}:last_run")
        count = await r.get(f"crawl:{key}:count")
        return {"last_run": last_run, "count": int(count) if count else 0}

    return {
        "bandai": await _source_status("bandai"),
        "optcgapi": await _source_status("optcgapi"),
        "limitlesstcg": await _source_status("limitlesstcg"),
        "banned": await _source_status("banned"),
    }


@router.get("/banned-cards")
async def banned_cards(driver: AsyncDriver = Depends(_get_driver)):
    return await get_banned_cards(driver)


@router.get("/stats")
async def stats(driver: AsyncDriver = Depends(_get_driver)):
    return await get_db_stats(driver)
