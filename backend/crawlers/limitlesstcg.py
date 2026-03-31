"""Crawler for onepiece.limitlesstcg.com — tournament deck lists and meta data."""

import asyncio
import json
import logging
import re
from pathlib import Path

import httpx

from backend.config import LIMITLESSTCG_BASE_URL, LIMITLESSTCG_DELAY, CRAWL_CACHE_DIR

logger = logging.getLogger(__name__)

CACHE_DIR = CRAWL_CACHE_DIR / "limitlesstcg"

# Minimum player count to consider a tournament worth crawling
MIN_PLAYERS = 100
# How many top placements to crawl per tournament
TOP_PLACEMENTS = 32


async def crawl_limitlesstcg(
    max_tournaments: int = 30,
    top_n: int = TOP_PLACEMENTS,
) -> dict:
    """Crawl tournament deck lists from Limitless TCG.

    Returns:
        {
            "tournaments": list[dict],
            "decks": list[dict],
        }
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=True,
        headers={"User-Agent": "OPTCGGraph/1.0 (deck research bot)"},
    ) as client:
        # 1. Get tournament list
        tournaments = await _crawl_tournaments(client, max_tournaments)
        logger.info(f"Found {len(tournaments)} tournaments with {MIN_PLAYERS}+ players")

        # 2. For each tournament, get top-N deck lists
        all_decks: list[dict] = []
        for i, tournament in enumerate(tournaments):
            logger.info(
                f"[{i+1}/{len(tournaments)}] Crawling decks from {tournament['name']} "
                f"({tournament['player_count']} players)..."
            )
            decks = await _crawl_tournament_decks(client, tournament, top_n)
            all_decks.extend(decks)
            logger.info(f"  Got {len(decks)} decks")

            if i < len(tournaments) - 1:
                await asyncio.sleep(LIMITLESSTCG_DELAY)

    # Cache final results
    (CACHE_DIR / "tournaments.json").write_text(json.dumps(tournaments, indent=2))
    (CACHE_DIR / "decks.json").write_text(json.dumps(all_decks, indent=2))

    logger.info(
        f"Limitless crawl complete: {len(tournaments)} tournaments, {len(all_decks)} decks"
    )
    return {"tournaments": tournaments, "decks": all_decks}


async def _crawl_tournaments(client: httpx.AsyncClient, max_count: int) -> list[dict]:
    """Fetch tournament list page and extract tournament metadata."""
    cache_file = CACHE_DIR / "tournaments_page.html"

    html = await _fetch_cached(client, f"{LIMITLESSTCG_BASE_URL}/tournaments", cache_file)
    if not html:
        return []

    tournaments = _parse_tournaments(html)

    # Filter by player count and limit
    tournaments = [t for t in tournaments if t["player_count"] >= MIN_PLAYERS]
    tournaments.sort(key=lambda t: t["player_count"], reverse=True)
    return tournaments[:max_count]


async def _crawl_tournament_decks(
    client: httpx.AsyncClient,
    tournament: dict,
    top_n: int,
) -> list[dict]:
    """Fetch a tournament's standings and then individual deck lists."""
    tid = tournament["id"]
    cache_file = CACHE_DIR / f"tournament_{tid}.html"

    html = await _fetch_cached(
        client, f"{LIMITLESSTCG_BASE_URL}/tournaments/{tid}", cache_file
    )
    if not html:
        return []

    await asyncio.sleep(LIMITLESSTCG_DELAY)

    # Extract deck list IDs from standings
    deck_entries = _parse_standings(html, top_n)

    decks: list[dict] = []
    for entry in deck_entries:
        deck_id = entry["deck_id"]
        deck_cache = CACHE_DIR / f"deck_{deck_id}.html"

        deck_html = await _fetch_cached(
            client, f"{LIMITLESSTCG_BASE_URL}/decks/list/{deck_id}", deck_cache
        )
        if not deck_html:
            continue

        deck = _parse_deck_list(deck_html, deck_id)
        if deck and deck.get("leader_id") and deck.get("cards"):
            deck.update({
                "tournament_id": tid,
                "placement": entry["placement"],
                "player_name": entry.get("player_name", ""),
                "source": "limitlesstcg",
            })
            decks.append(deck)

        await asyncio.sleep(LIMITLESSTCG_DELAY)

    return decks


async def _fetch_cached(
    client: httpx.AsyncClient,
    url: str,
    cache_file: Path,
    retries: int = 3,
) -> str | None:
    """Fetch URL with caching and retry."""
    if cache_file.exists():
        return cache_file.read_text()

    for attempt in range(retries):
        try:
            resp = await client.get(url)
            if resp.status_code == 200:
                text = resp.text
                cache_file.write_text(text)
                return text
            if resp.status_code in (429, 500, 502, 503):
                wait = (2 ** attempt) * 2
                logger.warning(f"  HTTP {resp.status_code} for {url}, retrying in {wait}s...")
                await asyncio.sleep(wait)
                continue
            logger.error(f"  HTTP {resp.status_code} for {url}")
            return None
        except httpx.RequestError as e:
            wait = (2 ** attempt) * 2
            logger.warning(f"  Request error: {e}, retrying in {wait}s...")
            await asyncio.sleep(wait)
    return None


# === HTML Parsing ===
# Using regex for lightweight parsing (no BeautifulSoup dependency)


def _parse_tournaments(html: str) -> list[dict]:
    """Parse tournament list page.

    HTML structure (table rows):
      <tr data-date="2026-03-21" data-name="Regional Melbourne" data-format="OP14.5">
        <td><a href="/tournaments/382">Regional Melbourne</a></td>
        <td>OP14.5</td>
        <td class="landscape-only">712</td>
      </tr>
    """
    tournaments = []

    # Parse table rows with data attributes (most reliable)
    row_pattern = re.compile(
        r'<tr\s+data-date="([^"]*)"[^>]*data-name="([^"]*)"[^>]*data-format="([^"]*)"'
        r'.*?/tournaments/(\d+)"'
        r'.*?</tr>',
        re.DOTALL,
    )

    for match in row_pattern.finditer(html):
        date_str, name, fmt, tid = match.groups()
        row_html = match.group(0)

        # Extract player count from the row's td cells
        player_count = 0
        # Look for a standalone number in a td (the player count cell)
        td_nums = re.findall(r'<td[^>]*>\s*(\d{1,5})\s*</td>', row_html)
        for num_str in td_nums:
            num = int(num_str)
            if 3 <= num <= 5000:  # Reasonable player count range
                player_count = num
                break

        tournaments.append({
            "id": tid,
            "name": name.strip(),
            "date": date_str,
            "format": fmt,
            "player_count": player_count,
            "source": "limitlesstcg",
        })

    # Fallback: simpler parsing if data attributes not found
    if not tournaments:
        entries = re.findall(
            r'href="/tournaments/(\d+)"[^>]*>\s*([^<]+?)\s*</a>',
            html,
        )
        for tid, name in entries:
            # Find context after this link to extract player count + format
            ctx_pattern = re.compile(
                rf'/tournaments/{re.escape(tid)}"[^>]*>[^<]+</a>(.*?)(?=</tr>)',
                re.DOTALL,
            )
            ctx = ctx_pattern.search(html)
            player_count = 0
            fmt = ""
            if ctx:
                nums = re.findall(r'>\s*(\d{2,4})\s*<', ctx.group(1))
                if nums:
                    player_count = int(nums[0])
                fmt_match = re.search(r'(OP\d+(?:\.\d+)?)', ctx.group(1))
                if fmt_match:
                    fmt = fmt_match.group(1)

            tournaments.append({
                "id": tid,
                "name": name.strip(),
                "date": "",
                "format": fmt,
                "player_count": player_count,
                "source": "limitlesstcg",
            })

    return tournaments


def _parse_standings(html: str, top_n: int) -> list[dict]:
    """Parse tournament standings page to extract deck list IDs and placements."""
    entries = []

    # Look for deck list links: /decks/list/{id}
    # With placement and player name in surrounding context
    pattern = re.compile(
        r'/decks/list/(\d+)"',
        re.IGNORECASE,
    )

    deck_ids = pattern.findall(html)

    # Get player names - typically in the same row as deck links
    # Pattern: player profile link or text near deck link
    player_pattern = re.compile(
        r'/players/\d+"[^>]*>\s*([^<]+?)\s*</a>.*?/decks/list/(\d+)"',
        re.DOTALL,
    )
    player_matches = player_pattern.findall(html)

    # Build player name lookup
    player_by_deck: dict[str, str] = {}
    for name, deck_id in player_matches:
        player_by_deck[deck_id] = name.strip()

    # Also try reverse pattern (deck link before player)
    reverse_pattern = re.compile(
        r'/decks/list/(\d+)".*?/players/\d+"[^>]*>\s*([^<]+?)\s*</a>',
        re.DOTALL,
    )
    for deck_id, name in reverse_pattern.findall(html):
        if deck_id not in player_by_deck:
            player_by_deck[deck_id] = name.strip()

    seen = set()
    for placement, deck_id in enumerate(deck_ids, 1):
        if deck_id in seen or placement > top_n:
            continue
        seen.add(deck_id)
        entries.append({
            "deck_id": deck_id,
            "placement": placement,
            "player_name": player_by_deck.get(deck_id, ""),
        })

    return entries


def _parse_deck_list(html: str, deck_id: str) -> dict | None:
    """Parse a single deck list page to extract leader and cards.

    HTML structure:
      <div class="decklist-card" data-count="4" data-id="OP09-069" data-variant="0">
        <a class="card-link" href="/cards/OP09-069">
          <span class="card-count">4</span>
          <span class="card-name">Trafalgar Law (OP09-069)</span>
        </a>
      </div>

    Leader section uses similar structure but with count=1 and separate heading.

    Returns:
        {"id": deck_id, "leader_id": str, "archetype": str,
         "cards": [{"id": str, "count": int}, ...]}
    """
    if not html:
        return None

    # Extract archetype from page title or header
    archetype = ""
    # Look for deck archetype in title or heading
    title_match = re.search(r'<title>([^<]+)</title>', html)
    if title_match:
        title = title_match.group(1).strip()
        # Clean up title: "Decklist played by X - Limitless" → archetype from context
        archetype = title

    # Better: look for archetype link (e.g., "Purple/Yellow Rosinante")
    arch_match = re.search(r'href="/decks/\d+"[^>]*>\s*([^<]+?)\s*</a>', html)
    if arch_match:
        archetype = arch_match.group(1).strip()

    # Extract ALL decklist-card entries using data-id and data-count
    card_pattern = re.compile(
        r'<div\s+class="decklist-card"\s+data-count="(\d+)"\s+data-id="([^"]+)"',
    )

    leader_id = ""
    cards: list[dict] = []
    seen_ids: set[str] = set()

    # Find the leader section vs main deck section
    # Leader typically appears before "Character" heading and has count=1
    leader_section = re.search(
        r'(?:Leader|leader).*?data-count="(\d+)"\s+data-id="([^"]+)"',
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if leader_section:
        leader_id = leader_section.group(2)

    # Parse all card entries
    for count_str, card_id in card_pattern.findall(html):
        count = int(count_str)
        if card_id in seen_ids:
            continue
        seen_ids.add(card_id)

        # Skip leader (already extracted, count=1 in leader section)
        if card_id == leader_id:
            continue

        cards.append({"id": card_id, "count": count})

    # Fallback leader detection: if no explicit leader section found,
    # first card with count=1 that has a leader-like ID pattern
    if not leader_id and cards:
        # The first entry is likely the leader
        for i, c in enumerate(cards):
            if c["count"] == 1:
                leader_id = c["id"]
                cards.pop(i)
                break

    if not leader_id and not cards:
        return None

    return {
        "id": deck_id,
        "leader_id": leader_id,
        "archetype": archetype,
        "cards": cards,
    }
