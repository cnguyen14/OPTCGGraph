"""Analyze tournament decks to detect distinct playstyles for a leader.

Queries all tournament decks for a leader, computes feature vectors
(avg cost, keyword ratios, etc.), clusters them into playstyle groups,
and extracts signature cards per cluster.
"""

import logging
from dataclasses import dataclass, field

from neo4j import AsyncDriver

logger = logging.getLogger(__name__)

# Keyword groups used for feature vector computation
EFFECT_KEYWORDS = {
    "rush": ["Rush"],
    "blocker": ["Blocker"],
    "draw": ["Draw"],
    "searcher": ["Search"],
    "removal": ["KO", "Bounce", "Trash", "Power Debuff", "Rest"],
    "double_attack": ["Double Attack"],
    "banish": ["Banish"],
}


@dataclass
class PlaystyleProfile:
    name: str
    description: str
    base_strategy: str  # "aggro" | "midrange" | "control"
    deck_count: int
    win_rate_hint: str  # e.g. "High placement rate" or ""
    signature_cards: list[str] = field(default_factory=list)  # top card IDs
    template_overrides: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "base_strategy": self.base_strategy,
            "deck_count": self.deck_count,
            "win_rate_hint": self.win_rate_hint,
            "signature_cards": self.signature_cards,
            "template_overrides": self.template_overrides,
        }


@dataclass
class _DeckFeatures:
    """Feature vector for a single tournament deck."""

    deck_id: str
    card_ids: list[str]
    avg_cost: float = 0.0
    rush_ratio: float = 0.0
    blocker_ratio: float = 0.0
    draw_ratio: float = 0.0
    searcher_ratio: float = 0.0
    removal_ratio: float = 0.0
    counter_density: float = 0.0
    low_cost_ratio: float = 0.0  # cost <= 2
    high_cost_ratio: float = 0.0  # cost >= 7
    placement: int | None = None


def _classify_deck(f: _DeckFeatures) -> str:
    """Classify a deck into a playstyle label based on its features."""
    if f.avg_cost < 3.5:
        if f.rush_ratio > 0.10:
            return "Rush Aggro"
        return "Wide Aggro"
    elif f.avg_cost <= 4.5:
        if (f.draw_ratio + f.searcher_ratio) > 0.12:
            return "Midrange Value"
        return "Midrange Balanced"
    else:
        if f.blocker_ratio > 0.15:
            return "Control Defensive"
        if f.removal_ratio > 0.12:
            return "Control Removal"
        return "Control Stall"


_PLAYSTYLE_META: dict[str, dict] = {
    "Rush Aggro": {
        "description": "Fast damage with low-cost Rush characters. Aims to win before opponent stabilizes.",
        "base_strategy": "aggro",
        "template_overrides": {
            "playstyle_hints": "rush,low_curve,fast_damage",
        },
    },
    "Wide Aggro": {
        "description": "Floods the board with cheap characters for wide attacks and high counter density.",
        "base_strategy": "aggro",
        "template_overrides": {
            "playstyle_hints": "low_curve,wide_board",
        },
    },
    "Midrange Value": {
        "description": "Card advantage engine with draw/search effects. Outvalues opponents in longer games.",
        "base_strategy": "midrange",
        "template_overrides": {
            "playstyle_hints": "card_advantage,value",
        },
    },
    "Midrange Balanced": {
        "description": "Well-rounded deck with flexible tools for any matchup. Adapts to the opponent's pace.",
        "base_strategy": "midrange",
        "template_overrides": {
            "playstyle_hints": "balanced",
        },
    },
    "Control Defensive": {
        "description": "Walls up with Blockers and high-power characters. Wins through attrition.",
        "base_strategy": "control",
        "template_overrides": {
            "playstyle_hints": "defensive,blockers",
        },
    },
    "Control Removal": {
        "description": "Clears threats with KO/Bounce/Trash effects. Controls the board until big finishers land.",
        "base_strategy": "control",
        "template_overrides": {
            "playstyle_hints": "removal_heavy,big_finishers",
        },
    },
    "Control Stall": {
        "description": "High-cost heavy deck that stalls early game and dominates late with powerful finishers.",
        "base_strategy": "control",
        "template_overrides": {
            "playstyle_hints": "big_finishers,defensive",
        },
    },
}


async def analyze_leader_playstyles(driver: AsyncDriver, leader_id: str) -> list[PlaystyleProfile]:
    """Analyze tournament decks to find distinct playstyles for a leader.

    Returns a list of PlaystyleProfile sorted by deck_count descending.
    If no tournament data exists, returns a default set of generic profiles.
    """
    # 1. Query all tournament decks for this leader with card details
    deck_features = await _load_deck_features(driver, leader_id)

    if not deck_features:
        logger.info(f"No tournament decks for {leader_id}, returning default profiles")
        return _default_profiles()

    # 2. Classify each deck
    clusters: dict[str, list[_DeckFeatures]] = {}
    for feat in deck_features:
        label = _classify_deck(feat)
        clusters.setdefault(label, []).append(feat)

    # 3. Build profiles with signature cards
    profiles: list[PlaystyleProfile] = []
    for label, decks in sorted(clusters.items(), key=lambda x: -len(x[1])):
        meta = _PLAYSTYLE_META.get(label, {})
        sig_cards = _extract_signature_cards(decks, top_n=5)

        # Win rate hint based on placements
        placements = [d.placement for d in decks if d.placement is not None]
        hint = ""
        if placements:
            avg_p = sum(placements) / len(placements)
            top_cut = sum(1 for p in placements if p <= 8)
            if top_cut / len(placements) > 0.3:
                hint = f"High top-cut rate ({top_cut}/{len(placements)} decks in top 8)"
            elif avg_p <= 16:
                hint = f"Avg placement: {avg_p:.0f}"

        profiles.append(
            PlaystyleProfile(
                name=label,
                description=meta.get("description", ""),
                base_strategy=meta.get("base_strategy", "midrange"),
                deck_count=len(decks),
                win_rate_hint=hint,
                signature_cards=sig_cards,
                template_overrides=meta.get("template_overrides", {}),
            )
        )

    return profiles


async def _load_deck_features(driver: AsyncDriver, leader_id: str) -> list[_DeckFeatures]:
    """Load all tournament decks for a leader and compute feature vectors."""
    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (d:Deck)-[:USES_LEADER]->(leader:Card {id: $leader_id})
            MATCH (d)-[inc:INCLUDES]->(c:Card)
            OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(k:Keyword)
            WITH d, c, inc.count AS copies, collect(DISTINCT k.name) AS keywords
            RETURN d.id AS deck_id,
                   d.placement AS placement,
                   collect({
                       card_id: c.id,
                       cost: c.cost,
                       power: c.power,
                       counter: c.counter,
                       card_type: c.card_type,
                       copies: copies,
                       keywords: keywords
                   }) AS cards
            """,
            leader_id=leader_id,
        )

        features: list[_DeckFeatures] = []
        async for record in result:
            cards = record["cards"]
            if not cards:
                continue

            # Expand by copies for accurate ratios
            total_cards = sum(c["copies"] or 1 for c in cards)
            if total_cards == 0:
                continue

            total_cost = 0.0
            total_counter = 0.0
            keyword_counts: dict[str, int] = {k: 0 for k in EFFECT_KEYWORDS}
            low_cost = 0
            high_cost = 0
            card_ids: list[str] = []

            for c in cards:
                copies = c["copies"] or 1
                cost = c["cost"] or 0
                counter = c["counter"] or 0
                kws = set(c["keywords"] or [])

                total_cost += cost * copies
                total_counter += counter * copies
                card_ids.extend([c["card_id"]] * copies)

                if cost <= 2:
                    low_cost += copies
                if cost >= 7:
                    high_cost += copies

                for group, group_kws in EFFECT_KEYWORDS.items():
                    if kws & set(group_kws):
                        keyword_counts[group] += copies

            feat = _DeckFeatures(
                deck_id=record["deck_id"],
                card_ids=card_ids,
                avg_cost=total_cost / total_cards,
                rush_ratio=keyword_counts["rush"] / total_cards,
                blocker_ratio=keyword_counts["blocker"] / total_cards,
                draw_ratio=keyword_counts["draw"] / total_cards,
                searcher_ratio=keyword_counts["searcher"] / total_cards,
                removal_ratio=keyword_counts["removal"] / total_cards,
                counter_density=total_counter / total_cards,
                low_cost_ratio=low_cost / total_cards,
                high_cost_ratio=high_cost / total_cards,
                placement=record["placement"],
            )
            features.append(feat)

        return features


def _extract_signature_cards(decks: list[_DeckFeatures], top_n: int = 5) -> list[str]:
    """Find cards that appear in 70%+ of the cluster's decks."""
    if not decks:
        return []

    card_freq: dict[str, int] = {}
    for d in decks:
        unique_ids = set(d.card_ids)
        for cid in unique_ids:
            card_freq[cid] = card_freq.get(cid, 0) + 1

    threshold = len(decks) * 0.7
    # Sort by frequency desc, then by card_id for stability
    signatures = sorted(
        [(cid, freq) for cid, freq in card_freq.items() if freq >= threshold],
        key=lambda x: (-x[1], x[0]),
    )
    return [cid for cid, _ in signatures[:top_n]]


def _default_profiles() -> list[PlaystyleProfile]:
    """Return generic profiles when no tournament data is available."""
    return [
        PlaystyleProfile(
            name="Aggro Rush",
            description="Fast, aggressive deck focused on low-cost characters and Rush keyword for early damage.",
            base_strategy="aggro",
            deck_count=0,
            win_rate_hint="",
            template_overrides={"playstyle_hints": "rush,low_curve,fast_damage"},
        ),
        PlaystyleProfile(
            name="Midrange Balanced",
            description="Well-rounded deck balancing offense and defense. Flexible for any matchup.",
            base_strategy="midrange",
            deck_count=0,
            win_rate_hint="",
            template_overrides={"playstyle_hints": "balanced"},
        ),
        PlaystyleProfile(
            name="Control",
            description="Defensive deck with removal and blockers. Wins through card advantage and big finishers.",
            base_strategy="control",
            deck_count=0,
            win_rate_hint="",
            template_overrides={"playstyle_hints": "defensive,removal_heavy,big_finishers"},
        ),
    ]
