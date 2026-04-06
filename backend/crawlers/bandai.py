"""Bandai Official Site Crawler — direct card data from onepiece-cardgame.com.

Crawls all card sets from Bandai's official card list pages.
Provides complete card data (name, type, cost, power, counter, color, family,
ability, rarity, attribute, images) without relying on third-party APIs.

Only pricing data needs external sources (optcgapi).
"""

import asyncio
import html as html_mod
import logging
import re
import time
from pathlib import Path
from typing import Any

import httpx

from backend.config import CRAWL_CACHE_DIR
from backend.crawlers.tracer import CrawlTracer

logger = logging.getLogger(__name__)

BANDAI_BASE_URL = "https://en.onepiece-cardgame.com"
BANDAI_IMG_BASE = f"{BANDAI_BASE_URL}/images/cardlist/card"
IMG_DIR = Path("data/card_images")

# All series from Bandai official site (extracted via Playwright 2026-04-05)
BANDAI_SERIES: dict[str, str] = {
    "569101": "OP-01", "569102": "OP-02", "569103": "OP-03", "569104": "OP-04",
    "569105": "OP-05", "569106": "OP-06", "569107": "OP-07", "569108": "OP-08",
    "569109": "OP-09", "569110": "OP-10", "569111": "OP-11", "569112": "OP-12",
    "569113": "OP-13", "569114": "OP14-EB04", "569115": "OP15-EB04",
    "569001": "ST-01", "569002": "ST-02", "569003": "ST-03", "569004": "ST-04",
    "569005": "ST-05", "569006": "ST-06", "569007": "ST-07", "569008": "ST-08",
    "569009": "ST-09", "569010": "ST-10", "569011": "ST-11", "569012": "ST-12",
    "569013": "ST-13", "569014": "ST-14", "569015": "ST-15", "569016": "ST-16",
    "569017": "ST-17", "569018": "ST-18", "569019": "ST-19", "569020": "ST-20",
    "569021": "ST-21", "569022": "ST-22", "569023": "ST-23", "569024": "ST-24",
    "569025": "ST-25", "569026": "ST-26", "569027": "ST-27", "569028": "ST-28",
    "569029": "ST-29",
    "569201": "EB-01", "569202": "EB-02", "569203": "EB-03",
    "569301": "PRB-01", "569302": "PRB-02",
    "569901": "Promo", "569801": "Other",
}

# Regex patterns for parsing card data from .modalCol blocks
_RE_INFO = re.compile(
    r'class="infoCol">\s*<span>([^<]+)</span>\s*\|\s*<span>([^<]+)</span>\s*\|\s*<span>([^<]+)</span>'
)
_RE_NAME = re.compile(r'class="cardName">(.*?)</div>', re.DOTALL)
_RE_IMG = re.compile(r'data-src="([^"]+\.png[^"]*)"')
_RE_COLOR = re.compile(r'class="color">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_POWER = re.compile(r'class="power">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_COST = re.compile(r'class="cost">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_COUNTER = re.compile(r'class="counter">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_ATTRIBUTE = re.compile(r'class="attribute">.*?<i>(.*?)</i>', re.DOTALL)
_RE_FEATURE = re.compile(r'class="feature">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_EFFECT = re.compile(r'class="text">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_SET_INFO = re.compile(r'class="getInfo">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_BLOCK = re.compile(r'class="block">.*?</h3>(.*?)</div>', re.DOTALL)
_RE_HTML_TAG = re.compile(r"<[^>]+>")


def _clean(text: str | None) -> str:
    """Strip HTML tags and whitespace."""
    if not text:
        return ""
    cleaned = _RE_HTML_TAG.sub("", text).strip()
    # Decode HTML entities (e.g. &amp; → &, &#039; → ')
    cleaned = html_mod.unescape(cleaned)
    # Normalize whitespace
    return re.sub(r"\s+", " ", cleaned)


def _to_int(val: str) -> int | None:
    """Convert string to int, returning None for '-' or empty."""
    val = val.strip()
    if not val or val == "-":
        return None
    try:
        return int(val)
    except ValueError:
        return None


def _extract_card_id_from_img(img_url: str) -> str:
    """Extract card ID from image URL, including parallel art suffix.

    '../images/cardlist/card/EB04-001_p1.png?260330' -> 'EB04-001_p1'
    """
    match = re.search(r"/([A-Z0-9]+-[A-Z0-9]+(?:_[a-z0-9]+)?)\.", img_url)
    return match.group(1) if match else ""


def _parse_set_info(set_info: str) -> tuple[str, str]:
    """Extract set_id and set_name from Bandai set info string.

    '-ADVENTURE ON KAMI'S ISLAND- [OP15-EB04]' -> ('OP15-EB04', 'ADVENTURE ON KAMI'S ISLAND')
    """
    bracket = re.search(r"\[([^\]]+)\]", set_info)
    set_id = bracket.group(1).strip() if bracket else ""
    set_name = re.sub(r"\[.*?\]", "", set_info).strip(" -")
    return set_id, set_name


def _parse_html(html: str, series_label: str) -> list[dict[str, Any]]:
    """Parse all cards from a Bandai series page HTML."""
    # Split by <dl class="modalCol"> blocks
    parts = re.split(r'<dl\s+class="modalCol"[^>]*>', html)
    if len(parts) <= 1:
        return []

    cards: list[dict[str, Any]] = []
    for block in parts[1:]:
        # Trim at closing </dl>
        block = block.split("</dl>")[0]

        info = _RE_INFO.search(block)
        if not info:
            continue

        base_id = info.group(1).strip()
        rarity = info.group(2).strip()
        card_type = info.group(3).strip()
        name = _clean(_RE_NAME.search(block).group(1)) if _RE_NAME.search(block) else ""

        # Image URL → derive actual card ID (handles parallel arts)
        img_match = _RE_IMG.search(block)
        img_path = img_match.group(1) if img_match else ""
        # Convert relative path: ../images/... → /images/...
        img_path = re.sub(r"^\.\.", "", img_path)
        # Strip query params for clean filename
        img_clean = re.sub(r"\?.*$", "", img_path)

        # Card ID: use image-derived ID if it has parallel art suffix, else base
        img_id = _extract_card_id_from_img(img_path)
        card_id = img_id if img_id else base_id

        # Parse fields
        color = _clean(_RE_COLOR.search(block).group(1)) if _RE_COLOR.search(block) else ""
        power = _clean(_RE_POWER.search(block).group(1)) if _RE_POWER.search(block) else ""
        cost_raw = _clean(_RE_COST.search(block).group(1)) if _RE_COST.search(block) else ""
        counter = _clean(_RE_COUNTER.search(block).group(1)) if _RE_COUNTER.search(block) else ""
        attribute = _clean(_RE_ATTRIBUTE.search(block).group(1)) if _RE_ATTRIBUTE.search(block) else ""
        family = _clean(_RE_FEATURE.search(block).group(1)) if _RE_FEATURE.search(block) else ""
        effect = _clean(_RE_EFFECT.search(block).group(1)) if _RE_EFFECT.search(block) else ""
        set_info = _clean(_RE_SET_INFO.search(block).group(1)) if _RE_SET_INFO.search(block) else ""

        set_id, set_name = _parse_set_info(set_info)

        # Determine if cost field is actually "Life" for leaders
        life = None
        cost = _to_int(cost_raw)
        if card_type == "LEADER":
            life = cost_raw.strip()
            cost = None

        cards.append({
            "id": card_id,
            "code": base_id,
            "name": name,
            "card_type": card_type,
            "cost": cost,
            "power": _to_int(power),
            "counter": _to_int(counter),
            "rarity": rarity,
            "attribute": attribute,
            "color": color,
            "family": family,
            "ability": effect,
            "trigger_effect": "",
            "image_url": img_path,  # Original Bandai URL path
            "image_filename": Path(img_clean).name if img_clean else "",
            "set_id": set_id,
            "set_name": set_name,
            "life": life,
            "inventory_price": None,
            "market_price": None,
            "source_bandai": True,
            "source_apitcg": False,
            "source_optcgapi": False,
            "_series_label": series_label,
        })

    return cards


async def _download_images(
    cards: list[dict[str, Any]],
    client: httpx.AsyncClient,
    tracer: CrawlTracer | None = None,
) -> int:
    """Download card images to local directory. Skip existing files."""
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    existing = {f.stem for f in IMG_DIR.glob("*.png")}

    to_download = [
        c for c in cards
        if c["id"] not in existing and c.get("image_url")
    ]

    if not to_download:
        logger.info("All %d images already downloaded", len(cards))
        return 0

    logger.info("Downloading %d images (%d already exist)", len(to_download), len(existing))

    downloaded = 0
    failed = 0
    sem = asyncio.Semaphore(20)

    async def _dl(card: dict) -> None:
        nonlocal downloaded, failed
        async with sem:
            url = f"{BANDAI_BASE_URL}{card['image_url']}"
            try:
                resp = await client.get(url, timeout=15.0)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    (IMG_DIR / f"{card['id']}.png").write_bytes(resp.content)
                    downloaded += 1
                else:
                    failed += 1
            except Exception:
                failed += 1

    batch_size = 100
    for i in range(0, len(to_download), batch_size):
        batch = to_download[i : i + batch_size]
        await asyncio.gather(*[_dl(c) for c in batch])
        if tracer:
            tracer.log(
                "image_download_progress",
                done=downloaded + failed,
                total=len(to_download),
                ok=downloaded,
                fail=failed,
            )

    logger.info("Image download: %d ok, %d failed", downloaded, failed)
    return downloaded


def _finalize_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Set local image paths and clean up internal fields."""
    for card in cards:
        # Use local path if image exists, otherwise keep Bandai URL
        local_path = IMG_DIR / f"{card['id']}.png"
        if local_path.exists():
            card["image_small"] = f"/api/images/{card['id']}.png"
            card["image_large"] = f"/api/images/{card['id']}.png"
        else:
            bandai_url = f"{BANDAI_BASE_URL}{card.get('image_url', '')}"
            card["image_small"] = bandai_url
            card["image_large"] = bandai_url

        # Remove internal fields
        card.pop("image_url", None)
        card.pop("image_filename", None)
        card.pop("_series_label", None)

    return cards


async def crawl_bandai(
    series_ids: list[str] | None = None,
    tracer: CrawlTracer | None = None,
    download_images: bool = True,
) -> list[dict[str, Any]]:
    """Crawl card data from Bandai official site.

    Args:
        series_ids: List of series IDs to crawl (None = all 51 series).
        tracer: Optional CrawlTracer for logging.
        download_images: Whether to download card images locally.

    Returns:
        List of normalized card dicts ready for Neo4j loading.
    """
    cache_dir = CRAWL_CACHE_DIR / "bandai"
    cache_dir.mkdir(parents=True, exist_ok=True)

    target_series = series_ids or list(BANDAI_SERIES.keys())
    all_cards: list[dict[str, Any]] = []
    t0 = time.time()

    if tracer:
        tracer.log("crawl_start", source="bandai", series_count=len(target_series))

    logger.info("Bandai crawl starting: %d series", len(target_series))

    async with httpx.AsyncClient(
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        follow_redirects=True,
        timeout=30.0,
    ) as client:
        for i, sid in enumerate(target_series):
            label = BANDAI_SERIES.get(sid, sid)
            url = f"{BANDAI_BASE_URL}/cardlist/?series={sid}"

            try:
                resp = await client.get(url)
                resp.raise_for_status()
                html = resp.text

                # Cache raw HTML
                (cache_dir / f"{sid}.html").write_text(html, encoding="utf-8")

                cards = _parse_html(html, label)
                all_cards.extend(cards)

                logger.info(
                    "  [%d/%d] %s: %d cards",
                    i + 1, len(target_series), label, len(cards),
                )

                if tracer:
                    tracer.log(
                        "series_crawled",
                        series_id=sid,
                        label=label,
                        cards=len(cards),
                        progress=f"{i + 1}/{len(target_series)}",
                    )

            except Exception as e:
                logger.error("Failed to crawl series %s (%s): %s", sid, label, e)
                if tracer:
                    tracer.log("series_error", series_id=sid, label=label, error=str(e))

            # Polite delay between requests
            await asyncio.sleep(0.3)

        # Download images
        if download_images and all_cards:
            await _download_images(all_cards, client, tracer)

    # Finalize: set local image paths
    all_cards = _finalize_cards(all_cards)

    elapsed = time.time() - t0
    logger.info(
        "Bandai crawl complete: %d cards from %d series in %.1fs",
        len(all_cards), len(target_series), elapsed,
    )

    if tracer:
        tracer.log(
            "crawl_finish",
            source="bandai",
            total_cards=len(all_cards),
            latency_ms=round(elapsed * 1000, 1),
        )

    return all_cards
