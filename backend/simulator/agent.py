"""AI agents for the OPTCG battle simulator.

Two agent classes:
  HeuristicAgent — rule-based (free, instant) for Virtual mode
  LLMAgent       — Claude-powered (costs $) for Real mode

Each agent supports a role ("player" or "bot") with 3 skill levels.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anthropic
import httpx

from backend.services.llm_service import MODEL_PREFERENCE
from backend.services.settings_service import (
    get_active_api_key,
    get_current_model_config,
)

from .models import (
    ActionType,
    CardState,
    DecisionPoint,
    EffectTrigger,
    EffectType,
    GameAction,
    GameCard,
    GameState,
    PlayerState,
)

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _is_anthropic_model(model: str) -> bool:
    """Check if a model ID should use the direct Anthropic API."""
    return model.startswith("claude-")


def _resolve_sim_model(model: str | None) -> str:
    """Resolve the simulator model from explicit value or active provider settings."""
    if model:
        return model
    config = get_current_model_config()
    provider = config.get("provider", "anthropic")
    if provider in ("claude", "anthropic"):
        return MODEL_PREFERENCE["anthropic"]["fast"]
    return MODEL_PREFERENCE["openrouter"]["fast"]


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

KEYWORD_VALUE: dict[str, float] = {
    "ko": 8.0,
    "bounce": 6.0,
    "draw": 5.0,
    "search": 4.0,
    "trash": 4.0,
    "rest": 3.0,
    "rush": 3.0,
    "blocker": 3.0,
    "double attack": 5.0,
    "buff": 2.0,
    "power buff": 2.0,
    "debuff": 3.0,
    "power debuff": 3.0,
}

EFFECT_TYPE_VALUE: dict[EffectType, float] = {
    EffectType.KO: 8.0,
    EffectType.BOUNCE: 6.0,
    EffectType.DRAW: 5.0,
    EffectType.DOUBLE_ATTACK: 5.0,
    EffectType.SEARCH: 4.0,
    EffectType.TRASH_FROM_HAND: 4.0,
    EffectType.PLAY_FROM_TRASH: 4.0,
    EffectType.BOTTOM_DECK: 5.0,
    EffectType.REST: 3.0,
    EffectType.RUSH: 3.0,
    EffectType.BLOCKER: 3.0,
    EffectType.POWER_REDUCE: 3.0,
    EffectType.DON_MINUS: 3.5,
    EffectType.POWER_BOOST: 2.0,
    EffectType.BANISH: 1.5,
    EffectType.PROTECT: 2.0,
    EffectType.COST_REDUCE: 2.5,
    EffectType.EXTRA_DON: 2.0,
    EffectType.ON_KO_DRAW: 2.0,
    EffectType.TRIGGER_PLAY: 2.0,
}

ON_PLAY_EFFECT_TYPES = {
    EffectType.KO,
    EffectType.BOUNCE,
    EffectType.DRAW,
    EffectType.SEARCH,
    EffectType.TRASH_FROM_HAND,
    EffectType.REST,
    EffectType.BOTTOM_DECK,
    EffectType.PLAY_FROM_TRASH,
    EffectType.POWER_REDUCE,
}

ON_PLAY_KEYWORDS = {"ko", "bounce", "draw", "search", "trash", "rest"}


def _keyword_score(card: GameCard) -> float:
    """Score a card's effects using templates (with keyword fallback)."""
    if card.effects:
        return sum(EFFECT_TYPE_VALUE.get(e.type, 0) for e in card.effects)
    return sum(KEYWORD_VALUE.get(kw.lower(), 0) for kw in card.keywords)


def _card_utility(card: GameCard, player: PlayerState) -> float:
    score = _keyword_score(card)
    if card.cost <= player.don_field + 2:
        score += 1.0
    if card.cost > 7 and player.don_field < 5:
        score -= 1.0
    return score


def _has_on_play_effect(card: GameCard) -> bool:
    """Check if card has an on-play effect worth prioritizing."""
    if card.effects:
        return any(
            e.trigger == EffectTrigger.ON_PLAY and e.type in ON_PLAY_EFFECT_TYPES
            for e in card.effects
        )
    return any(kw.lower() in ON_PLAY_KEYWORDS for kw in card.keywords)


def _find_card(instance_id: str, player: PlayerState) -> GameCard | None:
    if instance_id == player.leader.instance_id:
        return player.leader
    return player.find_card_on_field(instance_id)


def _extract_cost(action: GameAction) -> int:
    match = re.search(r"cost (\d+)", action.description)
    return int(match.group(1)) if match else 0


# ---------------------------------------------------------------------------
# Board evaluation (Phase 2: AI Intelligence)
# ---------------------------------------------------------------------------


def evaluate_board(state: GameState, player_id: str) -> float:
    """Score the board state from the perspective of player_id.

    Higher score = better position. Used by look-ahead action selection.
    Weights tuned to reflect OPTCG tempo/card advantage dynamics.
    """
    player = state.p1 if player_id == "p1" else state.p2
    opponent = state.p2 if player_id == "p1" else state.p1

    score = 0.0

    # Life advantage — life is both a resource and win condition
    # Being at 1 life is very bad; at 5 is great (but not linearly)
    score += len(player.life) * 120.0
    score -= len(opponent.life) * 120.0

    # Card advantage — hand size matters a lot
    score += len(player.hand) * 18.0
    score -= len(opponent.hand) * 10.0  # Opponent hand is less visible, weight less

    # Board power — total effective power on field (attacker threat)
    player_board_power = sum(c.effective_power for c in player.characters)
    opponent_board_power = sum(c.effective_power for c in opponent.characters)
    score += player_board_power * 0.004
    score -= opponent_board_power * 0.004

    # Leader power with DON attached (leader always matters)
    score += player.leader.effective_power * 0.002
    score -= opponent.leader.effective_power * 0.002

    # DON availability — more DON = more options
    score += player.don_field * 8.0
    score -= opponent.don_field * 4.0

    # Character count advantage
    score += len(player.characters) * 15.0
    score -= len(opponent.characters) * 15.0

    # Active characters = attack potential
    active_own = sum(1 for c in player.characters if c.state == CardState.ACTIVE)
    active_opp = sum(1 for c in opponent.characters if c.state == CardState.ACTIVE)
    score += active_own * 10.0
    score -= active_opp * 10.0

    # Blocker presence — defensive value
    blockers_own = sum(
        1 for c in player.characters if _has_effect(c, EffectType.BLOCKER)
    )
    score += blockers_own * 8.0

    # Effect quality on board
    for c in player.characters:
        score += _keyword_score(c) * 3.0
    for c in opponent.characters:
        score -= _keyword_score(c) * 3.0

    # Trash advantage (play_from_trash potential)
    score += len(player.trash) * 0.5

    return score


def _has_effect(card: GameCard, effect_type: EffectType) -> bool:
    """Check if card has a specific effect type."""
    if card.effects:
        return card.has_effect_type(effect_type)
    return False


def _estimate_action_value(
    action: GameAction,
    state: GameState,
    player: PlayerState,
    opponent: PlayerState,
) -> float:
    """Estimate the value of an action without full simulation.

    Returns a score representing the expected board value gained.
    This is a 0-step estimate (no deep copy needed) that considers:
    - Card play: effect value + power added to board
    - DON attach: power gap closed toward opponent
    - Attack: expected damage or board removal value
    - Pass: 0 baseline
    """
    if action.action_type == ActionType.PASS:
        return 0.0

    if action.action_type == ActionType.PLAY_CARD:
        card = player.find_card_in_hand(action.source_id)
        if not card:
            return 0.0
        # Base value: card effect utility + power/1000
        base = _keyword_score(card) * 4.0 + card.power * 0.001
        # Bonus for on-play effects (immediate impact)
        if _has_on_play_effect(card):
            base += 15.0
        # Cost efficiency: high cost / low don is bad
        remaining_don = player.don_field - card.cost
        if remaining_don < 0:
            return -999.0  # Illegal
        # Bonus for leaving DON for attacks
        if remaining_don >= 2:
            base += 5.0
        # Penalty for low-power cards late game
        if state.turn >= 6 and card.power < 4000:
            base -= 5.0
        # Near-lethal: don't play expensive cards — focus on killing
        opp_life = len(opponent.life)
        if opp_life <= 1 and card.cost >= 3:
            base *= 0.3
        elif opp_life <= 2 and card.cost >= 5:
            base *= 0.5
        return base

    if action.action_type == ActionType.ATTACH_DON:
        target = _find_card(action.target_id, player)
        if not target or target.state != CardState.ACTIVE:
            return -5.0  # Wasted DON on rested card
        new_power = target.effective_power + 1000
        opp_leader_power = opponent.leader.effective_power
        # Value = how much the gap closes toward opponent leader
        gap_before = opp_leader_power - target.effective_power
        gap_after = opp_leader_power - new_power
        if gap_before > 0 >= gap_after:
            return 25.0  # Crosses the threshold — very valuable
        if gap_before > 0 and gap_after < gap_before:
            return 12.0 + (gap_before - gap_after) * 0.005
        # Attach to already-winning attacker (less urgent)
        if gap_before <= 0:
            return 6.0
        return 3.0

    if action.action_type == ActionType.ATTACK:
        attacker = _find_card(action.source_id, player)
        target = _find_card(action.target_id, opponent)
        if not attacker or not target:
            return 0.0

        power_gap = attacker.effective_power - target.effective_power

        if target.card_type == "LEADER":
            opp_life = len(opponent.life)
            if power_gap < 0:
                return -8.0  # Attack will likely fail
            if opp_life == 0:
                return 200.0  # Win condition
            # Quadratic scaling: attack value increases FAST near lethal
            life_pressure = 5 - opp_life
            base_attack_value = 20.0 + life_pressure**2 * 5.0
            # L5: 20, L4: 25, L3: 40, L2: 65, L1: 100, L0: 145
            # Double attack bonus
            if _has_effect(attacker, EffectType.DOUBLE_ATTACK) and opp_life >= 2:
                base_attack_value += 25.0
            return base_attack_value if power_gap >= 0 else base_attack_value * 0.3
        else:
            # Attacking a rested character
            if power_gap < 0:
                return -5.0
            # Value = remove threat from board
            removal_value = (
                _keyword_score(target) * 5.0 + target.effective_power * 0.003
            )
            return removal_value + 10.0

    return 0.0


# ---------------------------------------------------------------------------
# Deck archetype detection
# ---------------------------------------------------------------------------


def _detect_archetype(player: PlayerState) -> str:
    """Detect deck archetype from leader + deck composition.

    Returns: "aggro", "midrange", or "control"
    """
    all_cards = list(player.deck) + list(player.hand) + list(player.field)
    if not all_cards:
        return "midrange"

    costs = [c.cost for c in all_cards if c.card_type != "LEADER"]
    if not costs:
        return "midrange"

    avg_cost = sum(costs) / len(costs)
    low_cost_ratio = sum(1 for c in costs if c <= 3) / len(costs)
    high_cost_ratio = sum(1 for c in costs if c >= 7) / len(costs)

    # Detect effect profile
    ko_count = sum(1 for c in all_cards if _has_effect(c, EffectType.KO))
    bounce_count = sum(1 for c in all_cards if _has_effect(c, EffectType.BOUNCE))
    blocker_count = sum(1 for c in all_cards if _has_effect(c, EffectType.BLOCKER))

    if avg_cost <= 3.5 and low_cost_ratio >= 0.4:
        return "aggro"
    if high_cost_ratio >= 0.2 or (ko_count + bounce_count) >= 8:
        return "control"
    if blocker_count >= 6:
        return "control"
    return "midrange"


# ---------------------------------------------------------------------------
# Profile definitions
# ---------------------------------------------------------------------------

PLAYER_PROFILES: dict[str, dict[str, Any]] = {
    "new": {
        "play_before_attack": 0.70,
        "hand_dump_rate": 0.80,
        "don_boost_awareness": 0.30,
        "attack_weak_targets": True,
        "counter_aggressively": True,
        "lethal_recognition": 0.20,
        "mistake_rate": 0.20,
        "omniscient_counters": False,
        "use_lookahead": False,
    },
    "amateur": {
        "play_before_attack": 0.30,
        "hand_dump_rate": 0.50,
        "don_boost_awareness": 0.70,
        "attack_weak_targets": False,
        "counter_aggressively": False,
        "lethal_recognition": 0.60,
        "mistake_rate": 0.08,
        "omniscient_counters": False,
        "use_lookahead": False,
    },
    "pro": {
        "play_before_attack": 0.10,
        "hand_dump_rate": 0.35,
        "don_boost_awareness": 1.00,
        "attack_weak_targets": False,
        "counter_aggressively": False,
        "lethal_recognition": 0.95,
        "mistake_rate": 0.02,
        "omniscient_counters": False,
        "use_lookahead": True,
    },
}

BOT_PROFILES: dict[str, dict[str, Any]] = {
    "easy": {
        "play_before_attack": 0.60,
        "hand_dump_rate": 0.70,
        "don_boost_awareness": 0.40,
        "attack_weak_targets": True,
        "counter_aggressively": True,
        "lethal_recognition": 0.30,
        "mistake_rate": 0.15,
        "omniscient_counters": False,
        "use_lookahead": False,
    },
    "medium": {
        "play_before_attack": 0.20,
        "hand_dump_rate": 0.45,
        "don_boost_awareness": 0.85,
        "attack_weak_targets": False,
        "counter_aggressively": False,
        "lethal_recognition": 0.75,
        "mistake_rate": 0.05,
        "omniscient_counters": False,
        "use_lookahead": False,
    },
    "hard": {
        "play_before_attack": 0.05,
        "hand_dump_rate": 0.30,
        "don_boost_awareness": 1.00,
        "attack_weak_targets": False,
        "counter_aggressively": False,
        "lethal_recognition": 0.98,
        "mistake_rate": 0.01,
        "omniscient_counters": True,
        "use_lookahead": True,
    },
}


# ===================================================================
# HeuristicAgent — rule-based, for Virtual mode
# ===================================================================


class HeuristicAgent:
    """Profile-driven rule-based agent for both Player and Bot roles.

    Parameters
    ----------
    role : "player" | "bot"
    level : "new" | "amateur" | "pro"  (player)
            "easy" | "medium" | "hard" (bot)
    """

    def __init__(
        self,
        role: str = "player",
        level: str = "amateur",
        rng: random.Random | None = None,
    ) -> None:
        profiles = PLAYER_PROFILES if role == "player" else BOT_PROFILES
        if level not in profiles:
            level = list(profiles.keys())[1]  # default middle
        self.role = role
        self.level = level
        self.profile = profiles[level]
        self.rng = rng or random.Random()
        self._cards_played_this_turn = 0
        self._attacks_made_this_turn = 0
        self._last_turn = -1
        self._archetype: str | None = None  # Detected lazily on first turn
        self._decision_collector: list[DecisionPoint] | None = None

    def set_decision_collector(self, collector: list[DecisionPoint]) -> None:
        """Set a collector list for decision point logging."""
        self._decision_collector = collector

    def _log_decision(
        self,
        state: GameState,
        legal_actions: list[GameAction],
        chosen_idx: int,
        scores: list[float] | None = None,
    ) -> None:
        """Log a decision point for training data export."""
        if self._decision_collector is None:
            return
        player = state.active_player
        opponent = state.defending_player
        action = legal_actions[chosen_idx] if chosen_idx < len(legal_actions) else None

        # Extract card_id for play_card actions
        source_card_id = ""
        if action and action.action_type == ActionType.PLAY_CARD and action.source_id:
            for card in player.hand:
                if card.instance_id == action.source_id:
                    source_card_id = card.card_id
                    break

        self._decision_collector.append(
            DecisionPoint(
                turn=state.turn,
                phase="main",
                player_id=player.player_id,
                player_life=len(player.life),
                opponent_life=len(opponent.life),
                player_hand_size=len(player.hand),
                player_field_power=sum(c.effective_power for c in player.characters),
                player_don_available=player.don_field,
                opponent_field_power=sum(
                    c.effective_power for c in opponent.characters
                ),
                opponent_hand_size=len(opponent.hand),
                num_legal_actions=len(legal_actions),
                action_scores=scores or [],
                chosen_action_index=chosen_idx,
                chosen_action_type=(action.action_type.value if action else "pass"),
                chosen_action_desc=(action.description if action else "pass"),
                source_card_id=source_card_id,
            )
        )

    # ------------------------------------------------------------------
    # Mulligan decision
    # ------------------------------------------------------------------

    async def choose_mulligan(self, hand: list[GameCard]) -> bool:
        """Decide whether to mulligan (redraw entire hand).

        Evaluates hand quality based on early-game playability.
        OPTCG strategy: you want at least 1-2 cards playable in turns 1-3.
        """
        prof = self.profile
        costs = [c.cost for c in hand]
        if not costs:
            return False

        avg_cost = sum(costs) / len(costs)
        low_cost_count = sum(1 for c in costs if c <= 3)
        mid_cost_count = sum(1 for c in costs if 4 <= c <= 5)
        has_on_play = any(_has_on_play_effect(c) for c in hand)

        # No early plays at all — always mulligan
        if low_cost_count == 0:
            return True

        # Hand is too expensive on average (lowered threshold)
        if avg_cost > 4.5:
            return True

        # No mid-game plays AND only 1 early play → bad hand
        if low_cost_count == 1 and mid_cost_count == 0:
            return True

        # Beginners mulligan erratically
        if prof["mistake_rate"] > 0.10:
            return self.rng.random() < 0.30

        # Skilled players: mulligan if hand lacks curve (no 1-2 cost + no 4-5 cost)
        has_low = any(c <= 2 for c in costs)
        has_mid = any(4 <= c <= 5 for c in costs)
        if not has_low and not has_mid:
            return self.rng.random() < 0.6

        # Only 1 early play and no effects → weak hand
        if low_cost_count <= 1 and not has_on_play:
            return self.rng.random() < 0.4

        return False

    # ------------------------------------------------------------------
    # Main phase
    # ------------------------------------------------------------------

    async def choose_main_action(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> int:
        if len(legal_actions) <= 1:
            self._log_decision(state, legal_actions, 0)
            return 0

        player = state.active_player
        opponent = state.defending_player
        prof = self.profile

        # Reset per-turn counters and detect archetype lazily
        if state.turn != self._last_turn:
            self._last_turn = state.turn
            self._cards_played_this_turn = 0
            self._attacks_made_this_turn = 0
            if self._archetype is None:
                self._archetype = _detect_archetype(player)

        # Mistake injection
        if self.rng.random() < prof["mistake_rate"]:
            return self.rng.randint(0, len(legal_actions) - 1)

        # Lethal check (gated by skill, always before look-ahead)
        if self.rng.random() < prof["lethal_recognition"]:
            lethal = self._check_lethal(state, legal_actions, player, opponent)
            if lethal is not None:
                return lethal

        # --- Look-ahead path for pro/hard agents ---
        if prof.get("use_lookahead"):
            return self._choose_by_scoring(state, legal_actions, player, opponent)

        # --- Heuristic path for new/amateur/easy/medium ---
        play_actions = [
            (i, a)
            for i, a in enumerate(legal_actions)
            if a.action_type == ActionType.PLAY_CARD
        ]
        don_actions = [
            (i, a)
            for i, a in enumerate(legal_actions)
            if a.action_type == ActionType.ATTACH_DON
        ]
        attack_actions = [
            (i, a)
            for i, a in enumerate(legal_actions)
            if a.action_type == ActionType.ATTACK
        ]

        plays_first = self.rng.random() < prof["play_before_attack"]
        has_attacks = len(attack_actions) > 0

        chosen: int | None = None
        if plays_first:
            chosen = self._try_play_card(play_actions, player)
            if chosen is None:
                chosen = self._try_attach_don(
                    don_actions, player, opponent, can_attack=has_attacks
                )
            if chosen is None:
                chosen = self._try_attack(attack_actions, player, opponent, state)
        else:
            chosen = self._try_attach_don(
                don_actions, player, opponent, can_attack=has_attacks
            )
            if chosen is None:
                chosen = self._try_attack(attack_actions, player, opponent, state)
            if chosen is None:
                chosen = self._try_play_card(play_actions, player)

        if chosen is None:
            chosen = len(legal_actions) - 1  # Pass

        self._log_decision(state, legal_actions, chosen)
        return chosen

    def _choose_by_scoring(
        self,
        state: GameState,
        legal_actions: list[GameAction],
        player: PlayerState,
        opponent: PlayerState,
    ) -> int:
        """Score all actions and pick the highest-value one (pro/hard path).

        Uses _estimate_action_value for each action with archetype-based
        adjustments. Replaces the rigid heuristic ordering.
        """
        archetype = self._archetype or "midrange"

        # Check if we have unplayed affordable cards with on-play effects
        has_unplayed_on_play = any(
            c.card_type in ("CHARACTER", "EVENT", "STAGE")
            and c.cost <= player.don_field
            and _has_on_play_effect(c)
            for c in player.hand
        )
        # Check if there are affordable cards at all
        has_playable_cards = any(
            c.card_type in ("CHARACTER", "EVENT", "STAGE")
            and c.cost <= player.don_field
            for c in player.hand
        )
        # Check if we have unattached DON and active attackers
        has_active_attackers = player.leader.state == CardState.ACTIVE or any(
            c.state == CardState.ACTIVE for c in player.characters
        )

        scored: list[tuple[int, float]] = []
        for i, action in enumerate(legal_actions):
            if action.action_type == ActionType.PASS:
                scored.append((i, 0.0))
                continue

            score = _estimate_action_value(action, state, player, opponent)

            # --- Play-before-attack sequencing ---
            # Smart agents should develop board and attach DON BEFORE attacking
            # But near lethal, attack immediately
            if action.action_type == ActionType.ATTACK:
                opp_life_count = len(opponent.life)
                if opp_life_count <= 1:
                    pass  # Near lethal — don't penalize attacks
                elif has_unplayed_on_play:
                    score *= 0.4
                elif player.don_field > 0 and has_active_attackers:
                    score *= 0.6
                elif has_playable_cards and self._cards_played_this_turn == 0:
                    score *= 0.7

            # --- DON before attack ---
            if action.action_type == ActionType.ATTACH_DON:
                # Boost DON attachment score when we have active attackers
                if has_active_attackers and self._attacks_made_this_turn == 0:
                    score *= 1.3

            # Archetype adjustments
            if archetype == "aggro":
                if action.action_type == ActionType.ATTACK:
                    score *= 1.3
                elif action.action_type == ActionType.PLAY_CARD:
                    card = player.find_card_in_hand(action.source_id)
                    if card and card.cost > 5:
                        score *= 0.7

            elif archetype == "control":
                if action.action_type == ActionType.PLAY_CARD:
                    card = player.find_card_in_hand(action.source_id)
                    if card and _has_on_play_effect(card):
                        score *= 1.25
                if action.action_type == ActionType.ATTACK:
                    target = _find_card(action.target_id, opponent)
                    if target and target.card_type == "LEADER":
                        if len(opponent.life) >= 4 and state.turn <= 5:
                            score *= 0.8

            # Hand dump penalty: don't empty hand recklessly
            if action.action_type == ActionType.PLAY_CARD:
                if len(player.hand) <= 2 and state.turn >= 4:
                    score *= 0.85

            scored.append((i, score))

        if scored:
            best_idx_val, best_score_val = max(scored, key=lambda x: x[1])
            all_scores = [s for _, s in sorted(scored, key=lambda x: x[0])]
            if best_score_val <= 0:
                chosen = len(legal_actions) - 1
            else:
                chosen = best_idx_val
            self._log_decision(state, legal_actions, chosen, all_scores)
            return chosen

        return len(legal_actions) - 1

    # ------------------------------------------------------------------
    # Blocker decision
    # ------------------------------------------------------------------

    async def choose_blockers(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> GameCard | None:
        if not blockers:
            return None

        life = len(state.defending_player.life)
        prof = self.profile

        # Attack won't succeed anyway
        if attacker.effective_power < target.effective_power:
            return None

        sorted_blockers = sorted(
            blockers, key=lambda b: _keyword_score(b) + b.effective_power / 1000.0
        )

        if target.card_type == "LEADER":
            if life <= 1:
                return sorted_blockers[0]  # must block at lethal
            if life <= 2 and prof["don_boost_awareness"] >= 0.7:
                return sorted_blockers[0]
            if prof["counter_aggressively"] and self.rng.random() < 0.5:
                return self.rng.choice(blockers)
            return None
        else:
            # Protect high-value characters (skilled players only)
            if prof["don_boost_awareness"] >= 0.85:
                tv = _keyword_score(target) + target.effective_power / 1000.0
                bv = (
                    _keyword_score(sorted_blockers[0])
                    + sorted_blockers[0].effective_power / 1000.0
                )
                if tv > bv + 2.0:
                    return sorted_blockers[0]
            return None

    # ------------------------------------------------------------------
    # Counter decision
    # ------------------------------------------------------------------

    async def choose_counters(
        self,
        state: GameState,
        hand: list[GameCard],
        attacker: GameCard,
        target: GameCard,
        power_gap: int,
    ) -> list[GameCard]:
        if power_gap <= 0:
            return []
        if target.card_type != "LEADER":
            return []

        life = len(state.defending_player.life)
        counter_cards = [c for c in hand if c.counter > 0]
        if not counter_cards:
            return []

        prof = self.profile
        archetype = self._archetype or "midrange"

        # Aggressive countering (new/easy players counter everything)
        if prof["counter_aggressively"]:
            if self.rng.random() < 0.7:
                return self._select_counters(
                    counter_cards, power_gap, state.defending_player
                )
            return []

        # Pro/hard path: evaluate whether countering is worth the card cost
        if prof.get("use_lookahead"):
            return self._smart_counter_decision(
                state, counter_cards, power_gap, life, archetype
            )

        # Standard heuristic: take early life, counter later
        if life >= 4:
            return []
        if life == 3:
            low_utility = [
                c
                for c in counter_cards
                if _card_utility(c, state.defending_player) < 3.0
            ]
            if low_utility:
                return self._select_counters(
                    low_utility, power_gap, state.defending_player, max_cards=2
                )
            return []
        # life <= 2: always try to counter
        sorted_by_utility = sorted(
            counter_cards, key=lambda c: _card_utility(c, state.defending_player)
        )
        return self._select_counters(
            sorted_by_utility, power_gap, state.defending_player
        )

    def _smart_counter_decision(
        self,
        state: GameState,
        counter_cards: list[GameCard],
        power_gap: int,
        life: int,
        archetype: str,
    ) -> list[GameCard]:
        """Pro/hard counter logic: weigh the cost of countering vs taking the hit.

        Key insight: countering costs a card from hand. Is that worth saving 1 life?
        - Life at 0 → taking hit loses the game → always counter
        - Life at 1 → critical → always counter
        - Life at 2 → counter with lowest-utility cards
        - Life at 3 → counter only with low-value expendable cards
        - Life at 4+ → take the hit (cards are more valuable)
        - Aggro decks: more willing to take hits for tempo
        - Control decks: counter more at life 3
        """
        player = state.defending_player

        # Always counter at 0 life (next hit loses)
        if life == 0:
            sorted_by_utility = sorted(
                counter_cards, key=lambda c: _card_utility(c, player)
            )
            return self._select_counters(sorted_by_utility, power_gap, player)

        # Critical life (1): always counter
        if life == 1:
            sorted_by_utility = sorted(
                counter_cards, key=lambda c: _card_utility(c, player)
            )
            return self._select_counters(sorted_by_utility, power_gap, player)

        # Dangerous (2): counter with lowest-utility cards
        if life == 2:
            if archetype == "aggro":
                # Aggro: counter with only expendable cards
                low_utility = [
                    c for c in counter_cards if _card_utility(c, player) < 3.0
                ]
                if low_utility:
                    return self._select_counters(
                        low_utility, power_gap, player, max_cards=2
                    )
                return []
            # Midrange/Control: always counter at life 2
            sorted_by_utility = sorted(
                counter_cards, key=lambda c: _card_utility(c, player)
            )
            return self._select_counters(sorted_by_utility, power_gap, player)

        # Life 3: only counter if opponent has many threats or we're control
        if life == 3:
            if archetype == "aggro":
                return []  # Aggro takes the hit for tempo
            # Only counter if power gap is small (1 cheap card covers it)
            low_utility = [c for c in counter_cards if _card_utility(c, player) < 2.5]
            if low_utility and low_utility[0].counter >= power_gap:
                return [low_utility[0]]  # Single cheap counter only
            return []  # Take the hit — cards are more valuable

        # Life 4+: take the hit — cards are more valuable than life
        return []

    # ------------------------------------------------------------------
    # Internal: play card
    # ------------------------------------------------------------------

    def _try_play_card(
        self, play_actions: list[tuple[int, GameAction]], player: PlayerState
    ) -> int | None:
        if not play_actions:
            return None

        affordable = [
            (i, a) for i, a in play_actions if _extract_cost(a) <= player.don_field
        ]
        if not affordable:
            return None

        max_plays = max(1, int(len(player.hand) * self.profile["hand_dump_rate"]))
        if self._cards_played_this_turn >= max_plays:
            return None

        best = max(affordable, key=lambda x: _extract_cost(x[1]))
        self._cards_played_this_turn += 1
        return best[0]

    # ------------------------------------------------------------------
    # Internal: attach DON
    # ------------------------------------------------------------------

    def _try_attach_don(
        self,
        don_actions: list[tuple[int, GameAction]],
        player: PlayerState,
        opponent: PlayerState,
        *,
        can_attack: bool = True,
    ) -> int | None:
        if not don_actions or player.don_field <= 0:
            return None
        # No point boosting power if we can't attack this turn
        if not can_attack:
            return None

        awareness = self.profile["don_boost_awareness"]

        # Low awareness: randomly attach to leader sometimes
        if awareness < 0.5:
            if self.rng.random() < awareness:
                leader_dons = [
                    (i, a)
                    for i, a in don_actions
                    if a.target_id == player.leader.instance_id
                    and player.leader.state == CardState.ACTIVE
                ]
                if leader_dons:
                    return leader_dons[0][0]
            return None

        # Smart DON attachment: only attach to ACTIVE cards, limit to what's needed
        opp_leader_power = opponent.leader.effective_power
        best: tuple[int, int] | None = None  # (action_idx, gap)

        for i, a in don_actions:
            card = _find_card(a.target_id, player)
            if card is None or card.state != CardState.ACTIVE:
                continue

            gap = opp_leader_power - card.effective_power
            if gap > 0 and gap <= player.don_field * 1000:
                if best is None or gap < best[1]:
                    best = (i, gap)

        if best is not None:
            # Check: don't spend ALL DON on boosting — reserve for critical card plays
            remaining_after = player.don_field - 1  # We attach 1 at a time
            # Only block DON attach if we have a card with on-play removal effect
            has_critical_play = any(
                c.cost <= remaining_after and _has_on_play_effect(c)
                for c in player.hand
                if c.card_type in ("CHARACTER", "EVENT", "STAGE")
            )
            if has_critical_play and remaining_after < 1:
                return None
            return best[0]

        # Attach to strongest active attacker if DON awareness is high
        if awareness >= 0.85:
            active_dons = [
                (i, a)
                for i, a in don_actions
                if _find_card(a.target_id, player) is not None
                and _find_card(a.target_id, player).state == CardState.ACTIVE  # type: ignore[union-attr]
            ]
            if active_dons:
                return active_dons[0][0]

        return None

    # ------------------------------------------------------------------
    # Internal: attack
    # ------------------------------------------------------------------

    def _try_attack(
        self,
        attack_actions: list[tuple[int, GameAction]],
        player: PlayerState,
        opponent: PlayerState,
        state: GameState,
    ) -> int | None:
        if not attack_actions:
            return None

        prof = self.profile
        leader_attacks: list[tuple[int, GameAction, int]] = []
        char_attacks: list[tuple[int, GameAction, int]] = []

        for i, a in attack_actions:
            attacker = _find_card(a.source_id, player)
            target = _find_card(a.target_id, opponent)
            if not attacker or not target:
                continue

            power_gap = attacker.effective_power - target.effective_power

            # Skip losing attacks unless profile allows weak targets
            if power_gap < 0 and not prof["attack_weak_targets"]:
                continue

            if target.card_type == "LEADER":
                leader_attacks.append((i, a, power_gap))
            else:
                char_attacks.append((i, a, power_gap))

        # Advanced: prefer KO-ing high-value rested characters first
        if not prof["attack_weak_targets"] and char_attacks:
            scored = []
            for i, a, gap in char_attacks:
                target = _find_card(a.target_id, opponent)
                if target and gap >= 0:
                    value = _keyword_score(target) + target.effective_power / 1000.0
                    scored.append((i, value))
            if scored:
                best_char = max(scored, key=lambda x: x[1])
                if best_char[1] > 5.0:
                    return best_char[0]

        # Attack leader
        if leader_attacks:
            viable = [(i, a, g) for i, a, g in leader_attacks if g >= 0]
            if viable:
                best = max(viable, key=lambda x: x[2])
                return best[0]
            # Weak-target players attack anyway
            if prof["attack_weak_targets"]:
                return leader_attacks[0][0]

        # Fallback to any viable character attack
        if char_attacks:
            viable = [(i, a, g) for i, a, g in char_attacks if g >= 0]
            if viable:
                return viable[0][0]
            if prof["attack_weak_targets"]:
                return char_attacks[0][0]

        return None

    # ------------------------------------------------------------------
    # Internal: lethal check
    # ------------------------------------------------------------------

    def _check_lethal(
        self,
        state: GameState,
        legal_actions: list[GameAction],
        player: PlayerState,
        opponent: PlayerState,
    ) -> int | None:
        opp_life = len(opponent.life)
        if opp_life > 3:
            return None

        viable: list[tuple[int, int]] = []
        for i, a in enumerate(legal_actions):
            if a.action_type != ActionType.ATTACK:
                continue
            if a.target_id != opponent.leader.instance_id:
                continue
            attacker = _find_card(a.source_id, player)
            if attacker and attacker.effective_power >= opponent.leader.effective_power:
                viable.append((i, attacker.effective_power))

        if len(viable) > opp_life:
            viable.sort(key=lambda x: -x[1])
            return viable[0][0]
        return None

    # ------------------------------------------------------------------
    # Internal: counter selection
    # ------------------------------------------------------------------

    def _select_counters(
        self,
        counter_cards: list[GameCard],
        power_gap: int,
        player: PlayerState,
        max_cards: int = 99,
    ) -> list[GameCard]:
        sorted_cards = sorted(
            counter_cards,
            key=lambda c: _card_utility(c, player),
        )
        selected: list[GameCard] = []
        total = 0
        for card in sorted_cards:
            if len(selected) >= max_cards:
                break
            selected.append(card)
            total += card.counter
            if total >= power_gap:
                return selected
        return [] if total < power_gap else selected


# ===================================================================
# LLMAgent — Claude-powered, for Real mode
# ===================================================================

# ---------------------------------------------------------------------------
# LLM Trace Logger — writes decision traces to JSONL for observability
# ---------------------------------------------------------------------------


class LLMTracer:
    """Logs every LLM interaction to a JSONL file for debugging/analysis."""

    def __init__(self, sim_folder: Path) -> None:
        self._path = sim_folder / "llm_trace.jsonl"
        self._file = self._path.open("a")

    def log(
        self,
        *,
        game_idx: int,
        turn: int,
        player: str,
        decision_type: str,
        model: str,
        prompt: str,
        raw_response: str | None,
        parsed_json: dict | None,
        chosen_action: str = "",
        was_fallback: bool = False,
        latency_ms: float = 0,
        error: str | None = None,
        game_state: dict | None = None,
        deck_profile: str = "",
        strategy: str = "",
    ) -> None:
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "game_idx": game_idx,
            "turn": turn,
            "player": player,
            "decision_type": decision_type,
            "model": model,
            "deck_profile": deck_profile,
            "strategy": strategy,
            "game_state": game_state or {},
            "prompt": prompt,
            "raw_response": raw_response,
            "parsed_json": parsed_json,
            "chosen_action": chosen_action,
            "was_fallback": was_fallback,
            "latency_ms": round(latency_ms, 1),
            "error": error,
        }
        self._file.write(json.dumps(record, default=str) + "\n")
        self._file.flush()

    def close(self) -> None:
        self._file.close()


LLM_PROMPTS: dict[str, str] = {
    "player_new": (
        "You are simulating a NEW OPTCG player. You know the basic rules but make "
        "common beginner mistakes:\n"
        "- You sometimes attack even when your power is lower (bad habit)\n"
        "- You often play all affordable cards immediately without planning\n"
        "- You counter almost every attack even at high life\n"
        "- You forget to attach DON!! before attacking sometimes\n\n"
        "Play naturally as a beginner would — not perfectly, but not randomly.\n"
    ),
    "player_amateur": (
        "You are simulating an AMATEUR OPTCG player with decent competitive experience.\n"
        "- You understand when to take life vs counter\n"
        "- You attach DON!! to attackers before attacking for power advantage\n"
        "- You prefer to KO rested characters when profitable\n"
        "- You sometimes miss optimal plays but never make obvious blunders\n\n"
        "Play at a solid intermediate level.\n"
    ),
    "player_pro": (
        "You are simulating a PROFESSIONAL OPTCG tournament player.\n"
        "- Calculate every decision for maximum expected value\n"
        "- Manage DON!! resources perfectly: boost attackers, reserve for plays\n"
        "- Take early life on purpose (life is a resource)\n"
        "- Recognize lethal opportunities and set up multi-turn kill sequences\n"
        "- Counter only when EV-positive; use minimum counter cards\n\n"
        "Play at the highest competitive level.\n"
    ),
    "bot_easy": (
        "You are a casual OPTCG bot. Play simply and predictably:\n"
        "- Play the highest-cost affordable card each turn\n"
        "- Attack the opponent's leader when you can\n"
        "- Counter most attacks to protect your life\n"
        "- Don't overthink — simple plays are fine\n\n"
        "Be a gentle opponent for beginners.\n"
    ),
    "bot_medium": (
        "You are a competitive OPTCG bot with strong fundamentals:\n"
        "- Develop board efficiently before attacking\n"
        "- Always attach DON!! to attackers before attacking\n"
        "- Only attack when you have power advantage\n"
        "- Use counter cards wisely — take early life, defend late game\n"
        "- KO high-value rested characters when possible\n\n"
        "Play optimally but not unfairly.\n"
    ),
    "bot_hard": (
        "You are an EXPERT OPTCG bot that plays near-perfectly:\n"
        "- Calculate exact lethal sequences when possible\n"
        "- Optimize DON!! distribution across attackers for maximum damage\n"
        "- Bait counters with weak attacks before committing strong ones\n"
        "- Never waste attacks on targets you can't beat\n"
        "- Manage hand resources and board state for long-term advantage\n\n"
        "Play at the absolute highest level. Show no mercy.\n"
    ),
}

LLM_BASE_RULES = """Game rules:
- Play characters/events by paying DON!! cost
- Attach DON!! to boost power (+1000 each) — ONLY to ACTIVE cards
- Attack succeeds when your power >= target (attacker WINS ties). Only fails if power < target.
- Attack opponent's Leader to remove Life, attack RESTED characters to KO them
- Characters enter RESTED when played (can't attack until next turn, unless Rush)
- DON boost on RESTED characters is WASTED — they can't attack this turn
- Win by removing all opponent Life then hitting their Leader one more time

Optimal turn sequence:
1) Attach DON to ACTIVE attackers first → 2) Attack with boosted characters → 3) Play new cards AFTER attacks
Exception: Play Rush cards BEFORE attacking (they can attack immediately).

Think briefly (1-2 sentences), then respond with JSON: {"action_index": N}"""


class LLMAgent:
    """LLM-powered agent for Real mode simulation.

    Parameters
    ----------
    role : "player" | "bot"
    level : "new" | "amateur" | "pro"  (player)
            "easy" | "medium" | "hard" (bot)
    model : Claude model ID
    """

    def __init__(
        self,
        role: str = "player",
        level: str = "amateur",
        model: str | None = None,
    ) -> None:
        self.model = _resolve_sim_model(model)
        self.role = role
        self.level = level
        self._use_openrouter = not _is_anthropic_model(self.model)
        if self._use_openrouter:
            self._openrouter_key = get_active_api_key("openrouter")
            if not self._openrouter_key:
                raise ValueError(
                    "OpenRouter API key not configured. Set it in Settings > BYOK."
                )
            self.client = None
            self._http_client = httpx.AsyncClient(timeout=15)
        else:
            claude_key = get_active_api_key("anthropic")
            if not claude_key:
                # Fallback: try OpenRouter if anthropic key missing
                or_key = get_active_api_key("openrouter")
                if or_key:
                    self._use_openrouter = True
                    self._openrouter_key = or_key
                    self.model = MODEL_PREFERENCE["openrouter"]["fast"]
                    self.client = None
                    self._http_client = httpx.AsyncClient(timeout=15)
                else:
                    raise ValueError(
                        "No LLM API key configured. Set one in Settings > BYOK."
                    )
            else:
                self._openrouter_key = ""
                self._http_client = None
                self.client = anthropic.AsyncAnthropic(api_key=claude_key)
        prompt_key = f"{role}_{level}"
        self._system = (
            LLM_PROMPTS.get(prompt_key, LLM_PROMPTS["bot_medium"])
            + "\n"
            + LLM_BASE_RULES
        )
        self._fallback = HeuristicAgent(role=role, level=level)
        self._decision_collector: list[DecisionPoint] | None = None
        # Phase B: Game memory
        self._decision_history: list[str] = []
        self._game_strategy: str = ""
        self._deck_profile: str = ""
        # Tracing
        self._tracer: LLMTracer | None = None
        self._game_idx: int = 0

    def set_tracer(self, tracer: LLMTracer, game_idx: int = 0) -> None:
        """Attach a tracer for logging LLM interactions."""
        self._tracer = tracer
        self._game_idx = game_idx

    def initialize_game(self, deck: list[GameCard], opponent_leader: GameCard) -> None:
        """Compute deck profile at game start for strategic context."""
        self._decision_history.clear()
        self._game_strategy = ""
        if not deck:
            return
        costs = [c.cost for c in deck]
        avg_cost = sum(costs) / len(costs) if costs else 0
        rush_count = sum(1 for c in deck if "Rush" in c.keywords)
        blocker_count = sum(1 for c in deck if "Blocker" in c.keywords)
        removal_count = sum(
            1
            for c in deck
            if any(k.lower() in ("ko", "bounce", "rest") for k in c.keywords)
        )
        counter_count = sum(1 for c in deck if c.counter > 0)
        if avg_cost <= 3.5 and rush_count >= 4:
            archetype = "Aggro"
        elif avg_cost >= 4.5 or removal_count >= 6:
            archetype = "Control"
        else:
            archetype = "Midrange"
        self._deck_profile = (
            f"{archetype} (avg cost {avg_cost:.1f}, "
            f"{rush_count} Rush, {blocker_count} Blocker, "
            f"{removal_count} Removal, {counter_count}/{len(deck)} Counter)"
        )
        if archetype == "Aggro":
            self._game_strategy = (
                "Rush damage early, use Rush characters, go for lethal by Turn 7"
            )
        elif archetype == "Control":
            self._game_strategy = (
                "Survive early, remove threats, win with high-cost finishers"
            )
        else:
            self._game_strategy = (
                "Build board efficiently, apply steady pressure, adapt to opponent"
            )
        logger.info(
            "LLM deck profile: %s | Strategy: %s",
            self._deck_profile,
            self._game_strategy,
        )

    def set_decision_collector(self, collector: list[DecisionPoint]) -> None:
        """Set collector for both LLM and fallback agents."""
        self._decision_collector = collector
        self._fallback.set_decision_collector(collector)

    def _log_decision(
        self,
        state: GameState,
        legal_actions: list[GameAction],
        chosen_idx: int,
    ) -> None:
        """Log a decision point (reuse HeuristicAgent pattern)."""
        if self._decision_collector is None:
            return
        player = state.active_player
        opponent = state.defending_player
        action = legal_actions[chosen_idx] if chosen_idx < len(legal_actions) else None
        self._decision_collector.append(
            DecisionPoint(
                turn=state.turn,
                phase="main",
                player_id=player.player_id,
                player_life=len(player.life),
                opponent_life=len(opponent.life),
                player_hand_size=len(player.hand),
                player_field_power=sum(c.effective_power for c in player.characters),
                player_don_available=player.don_field,
                opponent_field_power=sum(
                    c.effective_power for c in opponent.characters
                ),
                opponent_hand_size=len(opponent.hand),
                num_legal_actions=len(legal_actions),
                action_scores=[],
                chosen_action_index=chosen_idx,
                chosen_action_type=(action.action_type.value if action else "pass"),
                chosen_action_desc=(action.description if action else "pass"),
            )
        )

    def _trace(
        self,
        *,
        turn: int,
        player: str,
        decision_type: str,
        prompt: str,
        raw_response: str | None,
        parsed_json: dict | None,
        chosen_action: str = "",
        was_fallback: bool = False,
        latency_ms: float = 0,
        error: str | None = None,
        state: GameState | None = None,
    ) -> None:
        if not self._tracer:
            return
        game_state = None
        if state:
            # For counter/blocker, the deciding player is the defender
            if decision_type in ("counter", "blocker"):
                me = state.defending_player
                opp = state.active_player
            else:
                me = state.active_player
                opp = state.defending_player
            score = evaluate_board(state, me.player_id)
            phase = (
                "early" if state.turn <= 3 else ("mid" if state.turn <= 6 else "late")
            )
            game_state = {
                "life": len(me.life),
                "opp_life": len(opp.life),
                "don": me.don_field,
                "hand_size": len(me.hand),
                "field_size": len(me.characters),
                "board_eval": round(score, 1),
                "phase": phase,
            }
        self._tracer.log(
            game_idx=self._game_idx,
            turn=turn,
            player=player,
            decision_type=decision_type,
            model=self.model,
            prompt=prompt,
            raw_response=raw_response,
            parsed_json=parsed_json,
            chosen_action=chosen_action,
            was_fallback=was_fallback,
            latency_ms=latency_ms,
            error=error,
            game_state=game_state,
            deck_profile=self._deck_profile,
            strategy=self._game_strategy,
        )

    async def choose_mulligan(self, hand: list[GameCard]) -> bool:
        """Ask LLM whether to mulligan the opening hand."""
        prompt = self._build_mulligan_prompt(hand)
        t0 = time.monotonic()
        text = await self._call_llm(prompt)
        latency = (time.monotonic() - t0) * 1000
        if text is not None:
            try:
                data = json.loads(text)
                result = bool(data.get("mulligan", False))
                self._trace(
                    turn=0,
                    player=self.role,
                    decision_type="mulligan",
                    prompt=prompt,
                    raw_response=text,
                    parsed_json=data,
                    chosen_action=f"mulligan={result}",
                    latency_ms=latency,
                )
                return result
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                self._trace(
                    turn=0,
                    player=self.role,
                    decision_type="mulligan",
                    prompt=prompt,
                    raw_response=text,
                    parsed_json=None,
                    was_fallback=True,
                    latency_ms=latency,
                    error=str(e),
                )
                logger.debug(f"LLM mulligan parse error: {e}")
        else:
            self._trace(
                turn=0,
                player=self.role,
                decision_type="mulligan",
                prompt=prompt,
                raw_response=None,
                parsed_json=None,
                was_fallback=True,
                latency_ms=latency,
                error="no response",
            )
        return await self._fallback.choose_mulligan(hand)

    def _build_mulligan_prompt(self, hand: list[GameCard]) -> str:
        lines = [
            "MULLIGAN DECISION — You may redraw your entire hand ONCE.",
            "Your opening hand:",
        ]
        for card in hand:
            kw = f" [{', '.join(card.keywords)}]" if card.keywords else ""
            ability = ""
            if card.ability_text:
                txt = card.ability_text[:80]
                ability = f" — {txt}"
            lines.append(
                f"  {card.name} (Cost:{card.cost} P:{card.power}{kw}){ability}"
            )
        lines.append("")
        if self._deck_profile:
            lines.append(f"Deck: {self._deck_profile}")
        lines.append(
            "Consider: Do you have early plays (cost 1-3)? "
            "Is the curve good for turns 1-5?"
        )
        lines.append(
            'Respond with ONLY valid JSON: {"mulligan": true} or {"mulligan": false}'
        )
        return "\n".join(lines)

    def _is_trivial_decision(self, legal_actions: list[GameAction]) -> int | None:
        """Return action index if the decision is trivial enough to skip LLM."""
        if len(legal_actions) <= 1:
            return 0

        non_pass = [
            (i, a)
            for i, a in enumerate(legal_actions)
            if a.action_type != ActionType.PASS
        ]
        # Only pass available (all other actions filtered)
        if not non_pass:
            return len(legal_actions) - 1  # Pass is always last

        # Only 1 real action + pass → just do it
        if len(non_pass) == 1:
            return non_pass[0][0]

        return None

    async def choose_main_action(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> int:
        # Skip LLM for trivial decisions
        trivial = self._is_trivial_decision(legal_actions)
        if trivial is not None:
            action = legal_actions[trivial]
            self._decision_history.append(f"T{state.turn}: {action.description}")
            if len(self._decision_history) > 8:
                self._decision_history = self._decision_history[-8:]
            self._log_decision(state, legal_actions, trivial)
            return trivial

        prompt = self._build_prompt(state, legal_actions)
        t0 = time.monotonic()
        choice = await self._ask_llm(prompt, len(legal_actions))
        latency = (time.monotonic() - t0) * 1000
        action = legal_actions[choice]

        # Validate LLM choice — reject obviously bad decisions
        player = state.active_player
        opponent = state.defending_player
        was_fallback = False

        if action.action_type == ActionType.ATTACK:
            attacker = _find_card(action.source_id, player)
            target = _find_card(action.target_id, opponent)
            if (
                attacker
                and target
                and attacker.effective_power < target.effective_power
            ):
                was_fallback = True
                choice = await self._fallback.choose_main_action(state, legal_actions)
                action = legal_actions[choice]

        if not was_fallback and action.action_type == ActionType.ATTACH_DON:
            target = _find_card(action.target_id, player)
            if target and target.state == CardState.RESTED:
                was_fallback = True
                choice = await self._fallback.choose_main_action(state, legal_actions)
                action = legal_actions[choice]

        # Trace
        self._trace(
            turn=state.turn,
            player=player.player_id,
            decision_type="main_action",
            prompt=prompt,
            raw_response=None,
            parsed_json={"action_index": choice},
            chosen_action=action.description,
            was_fallback=was_fallback,
            latency_ms=latency,
            state=state,
        )

        # Log decision to history for future prompts
        self._decision_history.append(f"T{state.turn}: {action.description}")
        if len(self._decision_history) > 8:
            self._decision_history = self._decision_history[-8:]

        self._log_decision(state, legal_actions, choice)
        return choice

    async def choose_blockers(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> GameCard | None:
        if not blockers:
            return None
        prompt = self._build_blocker_prompt(state, blockers, attacker, target)
        t0 = time.monotonic()
        text = await self._call_llm(prompt)
        latency = (time.monotonic() - t0) * 1000
        if text is not None:
            try:
                data = json.loads(text)
                block_val = data.get("block")
                chosen = f"block={block_val}"
                self._trace(
                    turn=state.turn,
                    player=state.defending_player.player_id,
                    decision_type="blocker",
                    prompt=prompt,
                    raw_response=text,
                    parsed_json=data,
                    chosen_action=chosen,
                    latency_ms=latency,
                    state=state,
                )
                if block_val is None:
                    return None
                idx = int(block_val)
                if 0 <= idx < len(blockers):
                    return blockers[idx]
            except (json.JSONDecodeError, KeyError, IndexError, ValueError) as e:
                self._trace(
                    turn=state.turn,
                    player=state.defending_player.player_id,
                    decision_type="blocker",
                    prompt=prompt,
                    raw_response=text,
                    parsed_json=None,
                    was_fallback=True,
                    latency_ms=latency,
                    error=str(e),
                    state=state,
                )
                logger.debug(f"LLM blocker parse error: {e}")
        else:
            self._trace(
                turn=state.turn,
                player=state.defending_player.player_id,
                decision_type="blocker",
                prompt=prompt,
                raw_response=None,
                parsed_json=None,
                was_fallback=True,
                latency_ms=latency,
                error="no response",
                state=state,
            )
        return await self._fallback.choose_blockers(state, blockers, attacker, target)

    def _build_blocker_prompt(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> str:
        defender = state.defending_player
        target_type = "Leader" if target.card_type == "LEADER" else target.name
        lines = [
            f"BLOCKER DECISION — Opponent is attacking your {target_type} "
            f"(P:{target.effective_power}).",
            f"Attacker: {attacker.name} P:{attacker.effective_power}",
            f"Your life: {len(defender.life)} | Hand: {len(defender.hand)} cards",
            "",
            "Available blockers (blocker takes the hit instead, becomes RESTED):",
        ]
        for i, b in enumerate(blockers):
            lines.append(f"  [{i}] {b.name} P:{b.effective_power}")
        lines.append("")
        lines.append(
            'Respond with ONLY valid JSON: {"block": null} to not block, '
            'or {"block": 0} to use blocker at index 0, etc.'
        )
        return "\n".join(lines)

    async def choose_counters(
        self,
        state: GameState,
        hand: list[GameCard],
        attacker: GameCard,
        target: GameCard,
        power_gap: int,
    ) -> list[GameCard]:
        if power_gap <= 0:
            return []
        counter_cards = [c for c in hand if c.counter > 0]
        if not counter_cards:
            return []
        prompt = self._build_counter_prompt(
            state, counter_cards, attacker, target, power_gap
        )
        t0 = time.monotonic()
        text = await self._call_llm(prompt)
        latency = (time.monotonic() - t0) * 1000
        if text is not None:
            try:
                data = json.loads(text)
                indices = data.get("counters", [])
                self._trace(
                    turn=state.turn,
                    player=state.defending_player.player_id,
                    decision_type="counter",
                    prompt=prompt,
                    raw_response=text,
                    parsed_json=data,
                    chosen_action=f"counters={indices}",
                    latency_ms=latency,
                    state=state,
                )
                if isinstance(indices, list):
                    selected = [
                        counter_cards[i]
                        for i in indices
                        if isinstance(i, int) and 0 <= i < len(counter_cards)
                    ]
                    return selected
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                self._trace(
                    turn=state.turn,
                    player=state.defending_player.player_id,
                    decision_type="counter",
                    prompt=prompt,
                    raw_response=text,
                    parsed_json=None,
                    was_fallback=True,
                    latency_ms=latency,
                    error=str(e),
                    state=state,
                )
                logger.debug(f"LLM counter parse error: {e}")
        else:
            self._trace(
                turn=state.turn,
                player=state.defending_player.player_id,
                decision_type="counter",
                prompt=prompt,
                raw_response=None,
                parsed_json=None,
                was_fallback=True,
                latency_ms=latency,
                error="no response",
                state=state,
            )
        return await self._fallback.choose_counters(
            state, hand, attacker, target, power_gap
        )

    def _build_counter_prompt(
        self,
        state: GameState,
        counter_cards: list[GameCard],
        attacker: GameCard,
        target: GameCard,
        power_gap: int,
    ) -> str:
        defender = state.defending_player
        lines = [
            f"COUNTER DECISION — Opponent attacks your "
            f"{'Leader' if target.card_type == 'LEADER' else target.name} "
            f"(P:{target.effective_power}).",
            f"Attacker: {attacker.name} P:{attacker.effective_power} | "
            f"Power gap: {power_gap} (you need +{power_gap} to survive)",
            f"Your life: {len(defender.life)} | Hand: {len(defender.hand)} cards",
            "",
            "Counter cards in hand (discard to add counter value to defense):",
        ]
        for i, c in enumerate(counter_cards):
            kw = f" [{', '.join(c.keywords)}]" if c.keywords else ""
            lines.append(
                f"  [{i}] {c.name} (Cost:{c.cost} P:{c.power} Counter:+{c.counter}{kw})"
            )
        # Strategic guidance based on life
        life_count = len(defender.life)
        lines.append("")
        if life_count == 0:
            lines.append(
                "⚠ CRITICAL: Life = 0. If this attack hits your Leader, YOU LOSE. "
                "MUST counter if total counter >= power gap!"
            )
        elif life_count == 1:
            lines.append(
                "⚠ DANGER: Life = 1. Counter if possible — next unblocked hit is lethal."
            )
        elif life_count <= 3:
            lines.append(
                "Counter only with low-value cards (low cost, no important abilities). "
                "Preserve high-cost cards for playing."
            )
        else:
            lines.append(
                "Life is healthy (4+). DON'T counter — life is a resource. "
                "Keep cards in hand for playing. Take the hit."
            )
        lines.append("")
        lines.append(
            "Choose which cards to use as counters. Total counter must >= "
            f"{power_gap} to block the attack."
        )
        lines.append(
            'Respond with ONLY valid JSON: {"counters": []} to take the hit, '
            'or {"counters": [0, 2]} to use cards at those indices.'
        )
        return "\n".join(lines)

    def _build_prompt(self, state: GameState, legal_actions: list[GameAction]) -> str:
        player = state.active_player
        opponent = state.defending_player

        # Game phase awareness
        if state.turn <= 3:
            phase_hint = "EARLY GAME — prioritize board development, play characters"
        elif state.turn <= 6:
            phase_hint = "MID GAME — balance board presence + pressure opponent"
        else:
            phase_hint = "LATE GAME — push for lethal, maximize every action"

        # Board evaluation
        score = evaluate_board(state, player.player_id)
        if score > 30:
            position = f"AHEAD (+{score:.0f}) — maintain pressure, don't overcommit"
        elif score < -30:
            position = f"BEHIND ({score:.0f}) — attack aggressively even at equal power, force opponent to spend counters"
        else:
            position = f"EVEN ({score:+.0f}) — play for value"

        lines = [
            f"Turn {state.turn} | Life: {len(player.life)} vs {len(opponent.life)} | DON: {player.don_field} | {phase_hint}",
            f"Position: {position}",
        ]

        # Strategy context
        if self._game_strategy:
            lines.append(f"Strategy: {self._game_strategy}")

        # Decision history
        if self._decision_history:
            lines.append("Recent: " + " → ".join(self._decision_history[-5:]))

        lines.append("")
        lines.append(f"Hand ({len(player.hand)}):")
        for card in player.hand:
            kw = f" [{', '.join(card.keywords)}]" if card.keywords else ""
            ability = ""
            if card.ability_text:
                txt = card.ability_text[:80]
                ability = f" — {txt}"
            lines.append(
                f"  {card.name} (Cost:{card.cost} P:{card.power}{kw}){ability}"
            )

        lines.append("Your field:")
        lines.append(
            f"  Leader: {player.leader.name} P:{player.leader.effective_power} "
            f"{'ACTIVE' if player.leader.state == CardState.ACTIVE else 'RESTED'}"
        )
        for card in player.field:
            status = "ACTIVE" if card.state == CardState.ACTIVE else "RESTED"
            kw = f" [{', '.join(card.keywords)}]" if card.keywords else ""
            lines.append(f"  {card.name} P:{card.effective_power} {status}{kw}")

        # Opponent threat assessment
        lines.append("Opp field:")
        lines.append(
            f"  Leader: {opponent.leader.name} P:{opponent.leader.effective_power}"
        )
        opp_threats: list[str] = []
        for card in opponent.field:
            status = "ACTIVE" if card.state == CardState.ACTIVE else "RESTED"
            tags: list[str] = []
            if "Blocker" in card.keywords:
                tags.append("Blocker")
            if card.state == CardState.ACTIVE and card.effective_power >= 6000:
                tags.append("THREAT")
            tag_str = f" [{', '.join(tags)}]" if tags else ""
            lines.append(f"  {card.name} P:{card.effective_power} {status}{tag_str}")
            if card.state == CardState.ACTIVE and card.effective_power >= 5000:
                opp_threats.append(f"{card.name}({card.effective_power})")

        if opp_threats:
            lines.append(f"  ⚠ Active threats: {', '.join(opp_threats)}")

        lines.append("")
        lines.append("Legal actions:")
        for i, a in enumerate(legal_actions):
            desc = a.description
            # Annotate DON on RESTED targets as wasteful
            if a.action_type == ActionType.ATTACH_DON and a.target_id:
                target_card = _find_card(a.target_id, player)
                if target_card and target_card.state == CardState.RESTED:
                    desc += " ⚠ RESTED, can't attack this turn"
            lines.append(f"  [{i}] {desc}")

        return "\n".join(lines)

    async def _call_llm(self, prompt: str) -> str | None:
        """Call LLM and return raw response text, with retry for rate limits."""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                if self._use_openrouter:
                    return await self._call_openrouter(prompt)
                return await self._call_anthropic(prompt)
            except anthropic.RateLimitError:
                if attempt < max_retries - 1:
                    wait = 2**attempt
                    logger.warning(f"Rate limit hit, retrying in {wait}s...")
                    await asyncio.sleep(wait)
                    continue
                logger.warning("Rate limit exhausted after %d retries", max_retries)
                return None
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429 and attempt < max_retries - 1:
                    wait = 2**attempt
                    logger.warning(f"OpenRouter rate limit, retrying in {wait}s...")
                    await asyncio.sleep(wait)
                    continue
                logger.warning(f"OpenRouter HTTP error: {e}")
                return None
            except Exception as e:
                logger.warning(f"LLM call failed: {e}")
                return None
        return None

    async def _call_anthropic(self, prompt: str) -> str | None:
        """Direct Anthropic API call."""
        assert self.client is not None
        response = await self.client.messages.create(
            model=self.model,
            system=self._system,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
        )
        block = response.content[0]
        if not hasattr(block, "text"):
            return None
        return self._extract_json(block.text.strip())

    async def _call_openrouter(self, prompt: str) -> str | None:
        """OpenRouter API call (OpenAI-compatible format) with reused client."""
        resp = await self._http_client.post(
            OPENROUTER_URL,
            headers={"Authorization": f"Bearer {self._openrouter_key}"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": self._system},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 200,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return self._extract_json(content.strip()) if content else None

    @staticmethod
    def _extract_json(text: str) -> str:
        """Extract the last JSON object from LLM response (supports chain-of-thought)."""
        # Find last { ... } in response
        last_brace = text.rfind("}")
        if last_brace == -1:
            return text
        first_brace = text.rfind("{", 0, last_brace)
        if first_brace == -1:
            return text
        return text[first_brace : last_brace + 1]

    async def _ask_llm(self, prompt: str, num_options: int) -> int:
        """Ask LLM to choose a main-phase action index."""
        text = await self._call_llm(prompt)
        if text is None:
            return 0
        try:
            data = json.loads(text)
            idx = int(data.get("action_index", 0))
            return max(0, min(idx, num_options - 1))
        except (json.JSONDecodeError, KeyError, IndexError, ValueError) as e:
            logger.debug(f"LLM parse error: {e}")
            return 0
