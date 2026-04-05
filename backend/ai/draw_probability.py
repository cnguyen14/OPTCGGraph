"""Draw probability analysis using Hypergeometric distribution.

Calculates the probability of drawing specific cards from a 50-card OPTCG deck.
Used for deck consistency validation and simulation analysis.

Key formula: P(X≥1) = 1 - C(N-K, n) / C(N, n)
  N = deck size (50), K = copies in deck, n = cards drawn
"""

from collections import Counter
from math import comb

from backend.ai.deck_builder import ROLE_KEYWORDS

# Cards seen by turn N: opening hand (5) + N draw steps
# Turn 1: 5+1=6, Turn 2: 5+2=7, Turn 3: 5+3=8, Turn 4: 5+4=9, Turn 5: 5+5=10
CARDS_SEEN_BY_TURN = {1: 6, 2: 7, 3: 8, 4: 9, 5: 10}

# When each role is most needed
ROLE_TARGET_TURNS = {
    "blockers": 4,  # Need blockers by mid game
    "removal": 4,
    "draw": 3,      # Want draw engine early
    "searcher": 3,  # Searchers most valuable early
    "rush": 2,      # Rush matters turn 1-2
}


def p_draw_at_least_one(deck_size: int, copies: int, cards_drawn: int) -> float:
    """P(draw ≥1 copy) using hypergeometric distribution."""
    if copies <= 0 or cards_drawn <= 0:
        return 0.0
    if copies >= deck_size or cards_drawn >= deck_size:
        return 1.0
    return 1.0 - comb(deck_size - copies, cards_drawn) / comb(deck_size, cards_drawn)


def p_draw_at_least_k(
    deck_size: int, copies: int, cards_drawn: int, k: int
) -> float:
    """P(draw ≥k copies) using hypergeometric CDF complement."""
    if k <= 0:
        return 1.0
    if k > copies or k > cards_drawn:
        return 0.0

    # P(X < k) = sum of P(X=i) for i=0..k-1
    p_less_than_k = 0.0
    for i in range(k):
        # P(X=i) = C(K,i) * C(N-K, n-i) / C(N, n)
        if cards_drawn - i > deck_size - copies:
            continue
        if cards_drawn - i < 0:
            continue
        p_less_than_k += (
            comb(copies, i)
            * comb(deck_size - copies, cards_drawn - i)
            / comb(deck_size, cards_drawn)
        )

    return 1.0 - p_less_than_k


def analyze_deck_draw_probability(
    cards: list[dict], opening_hand: int = 5
) -> dict:
    """Compute draw probabilities for a full deck.

    Args:
        cards: List of 50 card dicts with id, name, cost, keywords, etc.
        opening_hand: Opening hand size (default 5 for OPTCG).

    Returns:
        Dict with early_game_access, role_access, per_card, consistency_score.
    """
    deck_size = len(cards)
    if deck_size == 0:
        return {
            "opening_hand_size": opening_hand,
            "deck_size": 0,
            "early_game_access": {"probability": 0, "eligible_cards": 0, "threshold": 0.80, "status": "FAIL"},
            "role_access": {},
            "per_card": [],
            "consistency_score": 0,
        }

    id_counts = Counter(c["id"] for c in cards)
    unique_cards = {}
    for c in cards:
        if c["id"] not in unique_cards:
            unique_cards[c["id"]] = c

    # --- Early game access ---
    # Count cards playable on turn 1-2 (cost ≤ 2)
    early_game_copies = sum(
        cnt for cid, cnt in id_counts.items()
        if (unique_cards[cid].get("cost") or 0) <= 2
    )
    early_p = p_draw_at_least_one(deck_size, early_game_copies, opening_hand)
    early_threshold = 0.80
    early_game_access = {
        "probability": round(early_p, 3),
        "eligible_cards": early_game_copies,
        "threshold": early_threshold,
        "status": "PASS" if early_p >= early_threshold else "WARNING",
    }

    # --- Role access ---
    # P(draw ≥1 card of each role by its target turn)
    role_access = {}
    for role, role_kws in ROLE_KEYWORDS.items():
        role_kw_set = set(role_kws)
        role_copies = sum(
            cnt for cid, cnt in id_counts.items()
            if set(unique_cards[cid].get("keywords") or []) & role_kw_set
        )
        target_turn = ROLE_TARGET_TURNS.get(role, 4)
        cards_seen = CARDS_SEEN_BY_TURN.get(target_turn, opening_hand + target_turn)
        p = p_draw_at_least_one(deck_size, role_copies, cards_seen)
        role_access[role] = {
            f"by_turn_{target_turn}": round(p, 3),
            "copies": role_copies,
        }

    # --- Per card probabilities ---
    per_card = []
    for cid, card in sorted(unique_cards.items(), key=lambda x: -(id_counts[x[0]])):
        copies = id_counts[cid]
        per_card.append({
            "card_id": cid,
            "name": card.get("name", ""),
            "copies": copies,
            "p_opening_hand": round(p_draw_at_least_one(deck_size, copies, opening_hand), 3),
            "p_by_turn_3": round(p_draw_at_least_one(deck_size, copies, CARDS_SEEN_BY_TURN[3]), 3),
            "p_by_turn_5": round(p_draw_at_least_one(deck_size, copies, CARDS_SEEN_BY_TURN[5]), 3),
        })

    # --- Consistency score (0-100) ---
    # 30 pts: early game access
    early_pts = 30.0 if early_p >= early_threshold else 30.0 * (early_p / early_threshold)

    # 25 pts: average role access by target turn
    role_probs = [
        v[f"by_turn_{ROLE_TARGET_TURNS.get(role, 4)}"]
        for role, v in role_access.items()
        if v["copies"] > 0
    ]
    avg_role_p = sum(role_probs) / len(role_probs) if role_probs else 0
    role_pts = 25.0 * min(avg_role_p / 0.80, 1.0)

    # 25 pts: four-copy ratio (% of unique cards at 4x)
    total_unique = len(unique_cards)
    four_copy_count = sum(1 for cnt in id_counts.values() if cnt == 4)
    four_copy_ratio = four_copy_count / total_unique if total_unique > 0 else 0
    four_copy_pts = 25.0 * min(four_copy_ratio / 0.50, 1.0)

    # 20 pts: searcher boost — decks with searchers have higher effective consistency
    searcher_copies = sum(
        cnt for cid, cnt in id_counts.items()
        if "Search" in (unique_cards[cid].get("keywords") or [])
    )
    searcher_boost = min(searcher_copies / 8, 1.0)  # Max boost at 8 searcher copies
    searcher_pts = 20.0 * searcher_boost

    consistency_score = round(early_pts + role_pts + four_copy_pts + searcher_pts, 1)

    return {
        "opening_hand_size": opening_hand,
        "deck_size": deck_size,
        "early_game_access": early_game_access,
        "role_access": role_access,
        "per_card": per_card,
        "consistency_score": consistency_score,
    }
