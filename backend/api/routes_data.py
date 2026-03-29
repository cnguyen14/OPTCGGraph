"""Data management API endpoints."""

from fastapi import APIRouter, BackgroundTasks, Depends
from neo4j import AsyncDriver

from backend.graph.connection import get_driver
from backend.graph.queries import get_db_stats

router = APIRouter(prefix="/api/data", tags=["data"])


async def _get_driver() -> AsyncDriver:
    return await get_driver()


@router.post("/crawl")
async def trigger_crawl(background_tasks: BackgroundTasks):
    """Trigger a full crawl pipeline in the background."""
    # Import here to avoid circular imports
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
        await load_cards(driver, merged)

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

    background_tasks.add_task(_update)
    return {"status": "price_update_started"}


@router.get("/stats")
async def stats(driver: AsyncDriver = Depends(_get_driver)):
    return await get_db_stats(driver)
