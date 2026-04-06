"""Data management API endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from neo4j import AsyncDriver

from backend.graph.connection import get_driver
from backend.graph.queries import get_db_stats, get_banned_cards
from backend.storage.redis_client import get_redis

router = APIRouter(prefix="/api/data", tags=["data"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


@router.post("/crawl")
async def trigger_crawl(background_tasks: BackgroundTasks):
    """Trigger a full crawl pipeline in the background."""
    from backend.crawlers.apitcg import crawl_apitcg
    from backend.crawlers.optcgapi import crawl_optcgapi
    from backend.crawlers.merge import merge_cards
    from backend.graph.builder import create_indexes, load_cards
    from backend.graph.connection import get_driver as gd

    async def _run_crawl():
        import asyncio
        apitcg_cards, optcgapi_cards = await asyncio.gather(
            crawl_apitcg(), crawl_optcgapi()
        )
        merged = merge_cards(apitcg_cards, optcgapi_cards)
        driver = await gd()
        await create_indexes(driver)
        count = await load_cards(driver, merged)

        # Track crawl metadata in Redis
        r = await get_redis()
        now = datetime.now(timezone.utc).isoformat()
        await r.set("crawl:apitcg:last_run", now)
        await r.set("crawl:apitcg:count", str(len(apitcg_cards)))
        await r.set("crawl:optcgapi:last_run", now)
        await r.set("crawl:optcgapi:count", str(len(optcgapi_cards)))
        await r.set("crawl:cards:total", str(count))

    background_tasks.add_task(_run_crawl)
    return {"status": "crawl_started"}


@router.post("/update-prices")
async def update_prices(background_tasks: BackgroundTasks):
    """Update pricing data from optcgapi (no full re-crawl)."""
    from backend.crawlers.optcgapi import crawl_optcgapi
    from backend.graph.connection import get_driver as gd

    async def _update():
        cards = await crawl_optcgapi()
        driver = await gd()
        count = 0
        async with driver.session() as session:
            for card in cards:
                if card.get("market_price") is not None:
                    await session.run(
                        """
                        MATCH (c:Card {id: $id})
                        SET c.market_price = $market_price,
                            c.inventory_price = $inventory_price
                        """,
                        id=card["id"],
                        market_price=card.get("market_price"),
                        inventory_price=card.get("inventory_price"),
                    )
                    count += 1

        # Track in Redis
        r = await get_redis()
        now = datetime.now(timezone.utc).isoformat()
        await r.set("crawl:optcgapi:last_run", now)
        await r.set("crawl:optcgapi:count", str(count))

    background_tasks.add_task(_update)
    return {"status": "price_update_started"}


@router.post("/crawl-banned")
async def crawl_banned(background_tasks: BackgroundTasks):
    """Crawl official banned card list and apply to Neo4j."""
    from backend.crawlers.banned_cards import crawl_banned_cards
    from backend.graph.builder import apply_ban_list
    from backend.graph.connection import get_driver as gd

    async def _run():
        banned = await crawl_banned_cards()
        driver = await gd()
        count = await apply_ban_list(driver, banned)

        # Track in Redis
        r = await get_redis()
        now = datetime.now(timezone.utc).isoformat()
        await r.set("crawl:banned:last_run", now)
        await r.set("crawl:banned:count", str(count))

    background_tasks.add_task(_run)
    return {"status": "ban_crawl_started"}


@router.post("/crawl-bandai")
async def crawl_bandai_endpoint(background_tasks: BackgroundTasks):
    """Crawl card data directly from Bandai official site."""
    from backend.crawlers.bandai import crawl_bandai
    from backend.graph.builder import create_indexes, load_cards
    from backend.graph.connection import get_driver as gd
    from backend.parser.ability_parser import build_keyword_graph
    from backend.graph.edges import build_all_edges

    async def _run():
        cards = await crawl_bandai(download_images=True)
        driver = await gd()
        await create_indexes(driver)
        await load_cards(driver, cards)
        await build_keyword_graph(driver)
        await build_all_edges(driver)

        r = await get_redis()
        now = datetime.now(timezone.utc).isoformat()
        await r.set("crawl:bandai:last_run", now)
        await r.set("crawl:bandai:count", str(len(cards)))

    background_tasks.add_task(_run)
    return {"status": "bandai_crawl_started"}


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
        "apitcg": await _source_status("apitcg"),
        "optcgapi": await _source_status("optcgapi"),
        "limitlesstcg": await _source_status("limitlesstcg"),
        "banned": await _source_status("banned"),
        "bandai": await _source_status("bandai"),
    }


@router.get("/banned-cards")
async def banned_cards(driver: AsyncDriver = Depends(_get_driver)):
    """Get list of all banned cards."""
    return await get_banned_cards(driver)


@router.get("/stats")
async def stats(driver: AsyncDriver = Depends(_get_driver)):
    return await get_db_stats(driver)
