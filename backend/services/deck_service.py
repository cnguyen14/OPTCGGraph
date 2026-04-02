"""Deck service — analysis, improvement, sim history, matchup analysis.

Extracted from the 825+ line routes_deck.py god file.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from neo4j import AsyncDriver

from backend.ai.deck_suggestions import suggest_fixes
from backend.ai.deck_validator import validate_deck
from backend.core.exceptions import CardNotFoundError
from backend.repositories.card_repository import CardRepository

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper functions (extracted from routes_deck.py)
# ---------------------------------------------------------------------------


def compute_deck_hash(card_ids: list[str]) -> str:
    """Compute a short deterministic hash for a deck's card list."""
    return hashlib.md5(json.dumps(sorted(card_ids)).encode()).hexdigest()[:12]


def find_sim_dir(sim_id: str) -> Path | None:
    """Find simulation directory by sim_id."""
    base = Path("data/simulations")
    if not base.exists():
        return None
    for d in base.iterdir():
        if d.is_dir() and sim_id[:8] in d.name:
            return d
    old_path = base / sim_id
    if old_path.exists():
        return old_path
    return None


def classify_playstyle(cards: list[dict]) -> str:
    """Detect playstyle from cost distribution."""
    costs = [c.get("cost") or 0 for c in cards if c.get("cost") is not None]
    if not costs:
        return "midrange"
    avg_cost = sum(costs) / len(costs)
    if avg_cost < 3.5:
        return "aggro"
    elif avg_cost > 5.0:
        return "control"
    return "midrange"


def count_card_roles(cards: list[dict]) -> dict[str, int]:
    """Count cards by strategic role based on keywords."""
    roles: dict[str, int] = {
        "blockers": 0,
        "removal": 0,
        "draw_search": 0,
        "rush": 0,
        "finishers": 0,
    }
    for card in cards:
        keywords = set(card.get("keywords") or [])
        if "Blocker" in keywords:
            roles["blockers"] += 1
        if keywords & {"KO", "Bounce", "Trash", "Power Debuff"}:
            roles["removal"] += 1
        if keywords & {"Draw", "Search"}:
            roles["draw_search"] += 1
        if "Rush" in keywords:
            roles["rush"] += 1
        if (card.get("cost") or 0) >= 7 and (card.get("power") or 0) >= 7000:
            roles["finishers"] += 1
    return roles


def compute_cost_curve(cards: list[dict]) -> dict[str, int]:
    """Compute cost distribution buckets."""
    curve: dict[str, int] = {"0-2": 0, "3-5": 0, "6-7": 0, "8+": 0}
    for card in cards:
        cost = card.get("cost")
        if cost is None:
            continue
        if cost <= 2:
            curve["0-2"] += 1
        elif cost <= 5:
            curve["3-5"] += 1
        elif cost <= 7:
            curve["6-7"] += 1
        else:
            curve["8+"] += 1
    return curve


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------


class DeckService:
    """Business logic for deck analysis, improvement, and matchup analysis."""

    def __init__(self, card_repo: CardRepository, driver: AsyncDriver):
        self.card_repo = card_repo
        self.driver = driver

    async def fetch_cards_validated(
        self, card_ids: list[str]
    ) -> list[dict]:
        """Fetch cards by ID, raise if any are missing."""
        cards = await self.card_repo.get_batch(card_ids)
        found_ids = {c["id"] for c in cards}
        missing = [cid for cid in card_ids if cid not in found_ids]
        if missing:
            raise CardNotFoundError(", ".join(missing[:10]))
        return cards

    async def validate(self, leader_id: str, card_ids: list[str]) -> dict:
        """Validate a deck against rules. Returns report dict."""
        leader = await self.card_repo.get_by_id(leader_id)
        if leader is None:
            raise CardNotFoundError(leader_id)

        cards = await self.fetch_cards_validated(card_ids)
        report = validate_deck(leader, cards)
        return report.to_dict()

    async def analyze(self, leader_id: str, card_ids: list[str]) -> dict:
        """Full deck analysis: validation, playstyle, synergy, roles, cost curve."""
        leader = await self.card_repo.get_by_id(leader_id)
        if leader is None:
            raise CardNotFoundError(leader_id)

        cards = await self.fetch_cards_validated(card_ids)

        report = validate_deck(leader, cards)
        validation = {
            "checks": [
                {"name": c.name, "status": c.status, "message": c.message}
                for c in report.checks
            ],
            "pass_count": len(report.passes),
            "fail_count": len(report.fails),
            "warning_count": len(report.warnings),
        }

        fix_result = await suggest_fixes(self.driver, leader_id, card_ids)
        suggestions = fix_result.get("suggestions", [])

        synergy_score = await self._compute_synergy_score(card_ids)
        playstyle = classify_playstyle(cards)
        card_roles = count_card_roles(cards)
        cost_curve = compute_cost_curve(cards)

        return {
            "validation": validation,
            "playstyle": playstyle,
            "synergy_score": synergy_score,
            "suggestions": suggestions,
            "card_roles": card_roles,
            "cost_curve": cost_curve,
        }

    async def improve(
        self,
        leader_id: str,
        card_ids: list[str],
        sim_card_stats: dict | None = None,
    ) -> dict:
        """AI-powered deck improvement suggestions."""
        leader = await self.card_repo.get_by_id(leader_id)
        if leader is None:
            raise CardNotFoundError(leader_id)

        cards = await self.fetch_cards_validated(card_ids)
        fix_result = await suggest_fixes(self.driver, leader_id, card_ids)
        existing_suggestions = fix_result.get("suggestions", [])

        improvements: list[dict] = []
        used_remove_ids: set[str] = set()
        used_add_ids: set[str] = set()

        # Sim-based weak card detection
        if sim_card_stats:
            weak_cards = [
                (card_id, stats)
                for card_id, stats in sim_card_stats.items()
                if stats.get("win_correlation", 1.0) < 0.3
                and stats.get("times_played", 0) >= 3
            ]
            weak_cards.sort(key=lambda x: x[1].get("win_correlation", 0))

            for card_id, stats in weak_cards[:5]:
                card_data = next((c for c in cards if c["id"] == card_id), None)
                card_name = card_data.get("name", card_id) if card_data else card_id

                replacement = None
                for sug in existing_suggestions:
                    add_id = sug.get("add", {}).get("id", "")
                    if add_id and add_id not in used_add_ids and add_id != card_id:
                        replacement = sug["add"]
                        used_add_ids.add(add_id)
                        break

                if replacement:
                    win_pct = int(stats.get("win_correlation", 0) * 100)
                    improvements.append({
                        "action": "swap",
                        "remove": {
                            "card_id": card_id,
                            "card_name": card_name,
                            "reason": f"Low win correlation ({win_pct}%)",
                        },
                        "add": {
                            "card_id": replacement["id"],
                            "card_name": replacement.get("name", ""),
                            "reason": replacement.get("benefit", "Better synergy with deck"),
                        },
                        "impact": "high",
                    })
                    used_remove_ids.add(card_id)

        # Add remaining suggestions from validation
        for sug in existing_suggestions:
            remove_id = sug.get("remove", {}).get("id", "")
            add_id = sug.get("add", {}).get("id", "")
            if remove_id in used_remove_ids or add_id in used_add_ids:
                continue

            priority = sug.get("priority", "low")
            impact = "high" if priority == "high" else ("medium" if priority == "medium" else "low")

            improvements.append({
                "action": "swap",
                "remove": {
                    "card_id": remove_id,
                    "card_name": sug.get("remove", {}).get("name", ""),
                    "reason": sug.get("remove", {}).get("reason", ""),
                },
                "add": {
                    "card_id": add_id,
                    "card_name": sug.get("add", {}).get("name", ""),
                    "reason": sug.get("add", {}).get("benefit", ""),
                },
                "impact": impact,
            })
            used_remove_ids.add(remove_id)
            used_add_ids.add(add_id)

        impact_order = {"high": 0, "medium": 1, "low": 2}
        improvements.sort(key=lambda imp: impact_order.get(imp["impact"], 9))

        n = len(improvements)
        if n == 0:
            summary = "No improvements needed — deck looks strong"
        else:
            areas: list[str] = []
            if any(imp["impact"] == "high" for imp in improvements):
                areas.append("critical fixes")
            role_counts = count_card_roles(cards)
            if role_counts["blockers"] < 4:
                areas.append("defensive coverage")
            if role_counts["finishers"] < 2:
                areas.append("late-game presence")
            if role_counts["removal"] < 4:
                areas.append("counter density")
            area_text = " and ".join(areas[:3]) if areas else "overall synergy"
            summary = f"{n} improvement{'s' if n != 1 else ''} suggested to strengthen {area_text}"

        return {"improvements": improvements, "summary": summary}

    async def _compute_synergy_score(self, card_ids: list[str]) -> int:
        """Compute 0-100 synergy score based on SYNERGY edges."""
        unique_ids = list(set(card_ids))
        async with self.driver.session() as session:
            result = await session.run(
                """
                MATCH (a:Card)-[s:SYNERGY]-(b:Card)
                WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id
                RETURN count(s) AS edge_count
                """,
                ids=unique_ids,
            )
            record = await result.single()
            edge_count = record["edge_count"] if record else 0

        n = len(unique_ids)
        max_edges = n * (n - 1) // 2 if n > 1 else 1
        raw_ratio = edge_count / max_edges
        score = min(100, int(raw_ratio * 600))
        return max(0, score)
