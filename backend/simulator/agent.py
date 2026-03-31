"""AI agents for the OPTCG battle simulator.

HeuristicAgent: Rule-based (free, instant) — good baseline.
SimulatorAgent: LLM-powered (Haiku, ~$0.03/game) — smarter decisions.
"""

from __future__ import annotations

import json
import logging
import random
from typing import Any

import anthropic

from backend.config import ANTHROPIC_API_KEY

from .models import (
    ActionType,
    CardState,
    GameAction,
    GameCard,
    GameState,
    PlayerState,
)

logger = logging.getLogger(__name__)

HAIKU_MODEL = "claude-haiku-4-5-20251001"

# --- Shared scoring constants for MaxStressAgent ---

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

ON_PLAY_KEYWORDS = {"ko", "bounce", "draw", "search", "trash", "rest"}


def _keyword_score(card: GameCard) -> float:
    """Sum keyword values for a card."""
    return sum(KEYWORD_VALUE.get(kw.lower(), 0) for kw in card.keywords)


def _card_utility(card: GameCard, player: PlayerState) -> float:
    """Future utility of keeping a card in hand (lower = safer to discard)."""
    score = _keyword_score(card)
    if card.cost <= player.don_field + 2:
        score += 1.0  # Playable soon
    if card.cost > 7 and player.don_field < 5:
        score -= 1.0  # Too expensive right now
    return score


def _has_on_play_effect(card: GameCard) -> bool:
    """Check if card has keywords that trigger on play."""
    return any(kw.lower() in ON_PLAY_KEYWORDS for kw in card.keywords)

SIMULATOR_SYSTEM = """You are an OPTCG (One Piece TCG) player. Pick the best action by index.

Game rules reminder:
- Play characters/events by paying DON!! cost
- Attach DON!! to boost power (+1000 each)
- Attack opponent's Leader to remove Life, attack rested characters to KO them
- Characters enter RESTED and can't attack until next turn (unless Rush)
- Win by removing all opponent Life then hitting their Leader one more time

Strategy tips:
- Play cards before attacking (to set up board)
- Attach DON!! to attackers before attacking
- Attack rested characters if you can KO them
- Attack Leader when you have power advantage
- Save DON!! for bigger plays if nothing good is affordable

Respond with ONLY valid JSON: {"action_index": N}
No explanation, no extra text."""


class HeuristicAgent:
    """Rule-based agent — prioritizes plays by simple heuristics.

    Priority: play highest-cost card → attach DON to strongest attacker →
    attack leader if advantageous → attack rested characters → pass.
    """

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()

    async def choose_main_action(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> int:
        player = state.active_player
        opponent = state.defending_player

        play_actions = [
            (i, a) for i, a in enumerate(legal_actions)
            if a.action_type == ActionType.PLAY_CARD
        ]
        don_actions = [
            (i, a) for i, a in enumerate(legal_actions)
            if a.action_type == ActionType.ATTACH_DON
        ]
        attack_actions = [
            (i, a) for i, a in enumerate(legal_actions)
            if a.action_type == ActionType.ATTACK
        ]

        # Decide: should we save DON for attacks or spend on cards?
        # If we have active attackers that could benefit from DON boost, prioritize DON
        best_attacker_power = 0
        if player.leader.state == CardState.ACTIVE:
            best_attacker_power = player.leader.effective_power
        for c in player.characters:
            if c.state == CardState.ACTIVE and c.effective_power > best_attacker_power:
                best_attacker_power = c.effective_power

        target_power = opponent.leader.effective_power
        need_don_boost = (
            best_attacker_power > 0
            and best_attacker_power < target_power
            and player.don_field > 0
            and (target_power - best_attacker_power) <= player.don_field * 1000
        )

        # 1. If we need DON to make attacks viable, attach DON first
        if need_don_boost and don_actions:
            return self._best_don_target(don_actions, player)

        # 2. Play highest-cost affordable card (but save DON for attacks if close)
        if play_actions:
            best_play = max(play_actions, key=lambda x: self._extract_cost(x[1]))
            play_cost = self._extract_cost(best_play[1])
            # Only play if we can still afford to boost for attack, or card is high value
            remaining_don = player.don_field - play_cost
            if remaining_don >= 0:
                if not need_don_boost or play_cost >= 3:
                    return best_play[0]

        # 3. Attach remaining DON to active attackers
        if don_actions:
            return self._best_don_target(don_actions, player)

        # 4. Attack — prefer leader, only attack if power advantage
        if attack_actions:
            viable_attacks: list[tuple[int, GameAction, int]] = []
            for i, a in attack_actions:
                attacker = player.find_card_on_field(a.source_id)
                if attacker is None and a.source_id == player.leader.instance_id:
                    attacker = player.leader
                target = opponent.find_card_on_field(a.target_id)
                if target is None and a.target_id == opponent.leader.instance_id:
                    target = opponent.leader
                if not attacker or not target:
                    continue
                if attacker.effective_power < target.effective_power:
                    continue
                gap = attacker.effective_power - target.effective_power
                score = gap
                if target.card_type == "LEADER":
                    score += 10000
                viable_attacks.append((i, a, score))

            if viable_attacks:
                viable_attacks.sort(key=lambda x: x[2], reverse=True)
                return viable_attacks[0][0]

        # 4. Pass
        return len(legal_actions) - 1

    async def choose_blockers(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> GameCard | None:
        # Block if targeting leader and a blocker can survive
        if target.card_type == "LEADER":
            for b in blockers:
                if b.effective_power >= attacker.effective_power:
                    return b
            # Block with weakest blocker even if it dies (to protect life)
            if blockers:
                return min(blockers, key=lambda b: b.effective_power)
        return None

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

        # Use minimum counters to survive if targeting leader
        if target.card_type != "LEADER":
            return []

        counter_cards = sorted(
            [c for c in hand if c.counter > 0],
            key=lambda c: c.counter,
            reverse=True,
        )
        selected: list[GameCard] = []
        total = 0
        for card in counter_cards:
            selected.append(card)
            total += card.counter
            if total >= power_gap:
                break

        return selected if total >= power_gap else []

    def _best_don_target(
        self,
        don_actions: list[tuple[int, GameAction]],
        player: PlayerState,
    ) -> int:
        """Attach DON to the best active attacker."""
        # Prefer leader if active
        leader_attach = [
            (i, a) for i, a in don_actions
            if a.target_id == player.leader.instance_id
            and player.leader.state == CardState.ACTIVE
        ]
        if leader_attach:
            return leader_attach[0][0]
        # Attach to strongest active character
        best_idx = don_actions[0][0]
        best_power = -1
        for i, a in don_actions:
            card = player.find_card_on_field(a.target_id)
            if card and card.state == CardState.ACTIVE and card.effective_power > best_power:
                best_power = card.effective_power
                best_idx = i
        return best_idx

    def _extract_cost(self, action: GameAction) -> int:
        """Extract cost from action description like 'Play X (cost 3)'."""
        import re
        match = re.search(r"cost (\d+)", action.description)
        return int(match.group(1)) if match else 0


class SimulatorAgent:
    """LLM-powered agent using Claude Haiku for game decisions.

    ~50-80 decisions per game, ~$0.03/game with Haiku.
    """

    def __init__(self, model: str = HAIKU_MODEL) -> None:
        self.client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        self.model = model
        self._fallback = HeuristicAgent()

    async def choose_main_action(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> int:
        if len(legal_actions) <= 1:
            return 0  # Only pass available

        prompt = self._build_main_prompt(state, legal_actions)
        return await self._ask_llm(prompt, len(legal_actions))

    async def choose_blockers(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> GameCard | None:
        if not blockers:
            return None

        options = ["Don't block"]
        for b in blockers:
            options.append(
                f"Block with {b.name} (P:{b.effective_power})"
            )

        prompt = (
            f"{attacker.name} (P:{attacker.effective_power}) is attacking "
            f"your {'Leader' if target.card_type == 'LEADER' else target.name} "
            f"(P:{target.effective_power}).\n"
            f"Your life: {len(state.defending_player.life)}\n"
            f"Options:\n"
        )
        for i, opt in enumerate(options):
            prompt += f"  [{i}] {opt}\n"

        choice = await self._ask_llm(prompt, len(options))
        if choice == 0:
            return None
        return blockers[choice - 1] if choice - 1 < len(blockers) else None

    async def choose_counters(
        self,
        state: GameState,
        hand: list[GameCard],
        attacker: GameCard,
        target: GameCard,
        power_gap: int,
    ) -> list[GameCard]:
        # Delegate to heuristic — counter decisions are relatively simple
        return await self._fallback.choose_counters(
            state, hand, attacker, target, power_gap
        )

    def _build_main_prompt(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> str:
        player = state.active_player
        opponent = state.defending_player

        lines = [
            f"Turn {state.turn} | Your life: {len(player.life)} | Opp life: {len(opponent.life)} | DON: {player.don_field}",
            f"Hand ({len(player.hand)}):",
        ]
        for card in player.hand:
            kw = f" [{', '.join(card.keywords)}]" if card.keywords else ""
            lines.append(f"  {card.name} (Cost:{card.cost} P:{card.power}{kw})")

        lines.append(f"Your field:")
        lines.append(
            f"  Leader: {player.leader.name} P:{player.leader.effective_power} "
            f"{'ACTIVE' if player.leader.state == CardState.ACTIVE else 'RESTED'}"
        )
        for card in player.field:
            status = "ACTIVE" if card.state == CardState.ACTIVE else "RESTED"
            lines.append(f"  {card.name} P:{card.effective_power} {status}")

        lines.append(f"Opp field:")
        lines.append(f"  Leader: {opponent.leader.name} P:{opponent.leader.effective_power}")
        for card in opponent.field:
            status = "ACTIVE" if card.state == CardState.ACTIVE else "RESTED"
            blocker = " [Blocker]" if "Blocker" in card.keywords else ""
            lines.append(f"  {card.name} P:{card.effective_power} {status}{blocker}")

        lines.append("Legal actions:")
        for i, a in enumerate(legal_actions):
            lines.append(f"  [{i}] {a.description}")

        return "\n".join(lines)

    async def _ask_llm(self, prompt: str, num_options: int) -> int:
        """Ask LLM for an action index. Falls back to heuristic on error."""
        try:
            response = await self.client.messages.create(
                model=self.model,
                system=SIMULATOR_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=50,
            )
            text = response.content[0].text.strip()

            # Parse JSON response
            data = json.loads(text)
            idx = int(data.get("action_index", 0))
            return max(0, min(idx, num_options - 1))

        except (json.JSONDecodeError, KeyError, IndexError, ValueError) as e:
            logger.debug(f"LLM parse error: {e}, response: {text if 'text' in dir() else 'N/A'}")
            return 0
        except Exception as e:
            logger.warning(f"LLM call failed: {e}")
            return 0


class MaxStressAgent:
    """Score-based agent that plays optimally as P2 to stress-test P1's deck.

    Two modes:
    - omniscient=True (God Mode): sees opponent's hand and deck
    - omniscient=False (Realistic): estimates from public info only
    """

    def __init__(
        self, rng: random.Random | None = None, omniscient: bool = True
    ) -> None:
        self.rng = rng or random.Random()
        self.omniscient = omniscient
        self._last_turn = -1
        self._lethal_plan: list[int] | None = None

    # --- Information access layer ---

    def _get_opponent(self, state: GameState) -> PlayerState:
        return state.p1 if state.active_player_id == "p2" else state.p2

    def _estimate_opponent_counters(self, state: GameState) -> int:
        opponent = self._get_opponent(state)
        if self.omniscient:
            return sum(c.counter for c in opponent.hand)
        # Realistic: ~60% of hand has counters averaging 1000
        return int(len(opponent.hand) * 0.6 * 1000)

    # --- Main phase decision ---

    async def choose_main_action(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> int:
        if len(legal_actions) <= 1:
            return 0

        player = state.active_player
        opponent = self._get_opponent(state)

        # Reset lethal plan on new turn
        if state.turn != self._last_turn:
            self._last_turn = state.turn
            self._lethal_plan = None

        # Consume lethal plan if active
        if self._lethal_plan:
            if self._lethal_plan:
                idx = self._lethal_plan.pop(0)
                if idx < len(legal_actions):
                    return idx
            self._lethal_plan = None

        # Phase 1: Lethal check
        lethal_seq = self._check_lethal(state, legal_actions, player, opponent)
        if lethal_seq:
            self._lethal_plan = lethal_seq[1:]  # Save rest for next calls
            return lethal_seq[0]

        # Phase 2: Score every action
        scores: list[float] = []
        for i, action in enumerate(legal_actions):
            scores.append(self._score_action(action, state, player, opponent))

        return int(max(range(len(scores)), key=lambda i: scores[i]))

    def _check_lethal(
        self,
        state: GameState,
        legal_actions: list[GameAction],
        player: PlayerState,
        opponent: PlayerState,
    ) -> list[int] | None:
        """Check if we can kill opponent this turn. Returns action index sequence or None."""
        life_to_clear = len(opponent.life) + 1  # life cards + final blow
        estimated_counters = self._estimate_opponent_counters(state)
        opp_leader_power = opponent.leader.effective_power

        # Collect active attackers and their potential
        active_attackers: list[tuple[GameCard, bool]] = []  # (card, is_leader)
        if player.leader.state == CardState.ACTIVE:
            active_attackers.append((player.leader, True))
        for c in player.characters:
            if c.state == CardState.ACTIVE:
                active_attackers.append((c, False))

        if not active_attackers:
            return None

        # Count how many successful hits we can land on leader
        # Each hit needs effective_power >= opp_leader_power
        don_available = player.don_field
        hits = 0
        don_needed: list[tuple[GameCard, int]] = []  # (card, don to attach)

        for card, _is_leader in active_attackers:
            gap = opp_leader_power - card.effective_power
            if gap <= 0:
                hits += 1
                # Check double attack
                if any(kw.lower() == "double attack" for kw in card.keywords):
                    hits += 1
                don_needed.append((card, 0))
            elif gap <= don_available * 1000:
                don_count = (gap + 999) // 1000  # Ceil division
                don_available -= don_count
                hits += 1
                if any(kw.lower() == "double attack" for kw in card.keywords):
                    hits += 1
                don_needed.append((card, don_count))

        # Account for counters reducing our hits
        # Rough: each 1000 counter can negate one marginal hit
        counter_negated_hits = estimated_counters // max(opp_leader_power, 1000)
        effective_hits = hits - counter_negated_hits

        if effective_hits < life_to_clear:
            return None

        # Build action sequence: DON attachments first, then attacks
        sequence: list[int] = []

        # Attach DON
        for card, don_count in don_needed:
            for _ in range(don_count):
                for j, a in enumerate(legal_actions):
                    if (
                        a.action_type == ActionType.ATTACH_DON
                        and a.target_id == card.instance_id
                        and j not in sequence
                    ):
                        sequence.append(j)
                        break

        # Attack leader with strongest first (to overwhelm counters)
        attack_indices: list[tuple[int, int]] = []  # (index, power)
        for j, a in enumerate(legal_actions):
            if (
                a.action_type == ActionType.ATTACK
                and a.target_id == opponent.leader.instance_id
            ):
                # Find attacker power
                src = player.find_card_on_field(a.source_id)
                if src is None and a.source_id == player.leader.instance_id:
                    src = player.leader
                power = src.effective_power if src else 0
                attack_indices.append((j, power))

        # Sort by power descending (strongest attacks first to burn counters)
        attack_indices.sort(key=lambda x: -x[1])
        sequence.extend(idx for idx, _ in attack_indices)

        return sequence if sequence else None

    def _score_action(
        self,
        action: GameAction,
        state: GameState,
        player: PlayerState,
        opponent: PlayerState,
    ) -> float:
        if action.action_type == ActionType.PLAY_CARD:
            return self._score_play(action, player, opponent)
        elif action.action_type == ActionType.ATTACH_DON:
            return self._score_don(action, player, opponent)
        elif action.action_type == ActionType.ATTACK:
            return self._score_attack(action, state, player, opponent)
        elif action.action_type == ActionType.PASS:
            return 0.0
        return 0.0

    def _score_play(
        self, action: GameAction, player: PlayerState, opponent: PlayerState
    ) -> float:
        card = player.find_card_in_hand(action.source_id)
        if not card:
            return 1.0

        score = _keyword_score(card) + card.power / 1000.0

        # Board need: bonus if we have fewer characters
        if len(player.characters) < len(opponent.characters):
            score += 3.0

        # Blocker bonus when opponent has active attackers
        active_opp = sum(
            1 for c in opponent.characters if c.state == CardState.ACTIVE
        )
        if any(kw.lower() == "blocker" for kw in card.keywords) and active_opp > 0:
            score += 2.0

        # On-play effect bias: resolve effects before attacks
        if _has_on_play_effect(card):
            score += 1.0

        # Resource waste penalty: playing this empties DON with better cards waiting
        remaining_don = player.don_field - card.cost
        if remaining_don == 0:
            better_in_hand = any(
                _keyword_score(c) > _keyword_score(card)
                and c.cost <= player.don_field + 2
                and c.instance_id != card.instance_id
                for c in player.hand
            )
            if better_in_hand:
                score -= 3.0

        return score

    def _score_don(
        self, action: GameAction, player: PlayerState, opponent: PlayerState
    ) -> float:
        target = player.find_card_on_field(action.target_id)
        if target is None and action.target_id == player.leader.instance_id:
            target = player.leader
        if target is None:
            return 0.5

        # Attached to active card that can attack = high value
        if target.state == CardState.ACTIVE:
            score = 4.0
            # Would this enable a successful leader attack?
            new_power = target.effective_power + 1000
            if new_power >= opponent.leader.effective_power:
                score += 2.0
            # Would this enable KO of a rested opponent character?
            for opp_card in opponent.characters:
                if (
                    opp_card.state == CardState.RESTED
                    and new_power >= opp_card.effective_power
                    and target.effective_power < opp_card.effective_power
                ):
                    score += 3.0
                    break
            return score

        # Target is rested — low value
        return 0.5

    def _score_attack(
        self,
        action: GameAction,
        state: GameState,
        player: PlayerState,
        opponent: PlayerState,
    ) -> float:
        # Find attacker
        attacker = player.find_card_on_field(action.source_id)
        if attacker is None and action.source_id == player.leader.instance_id:
            attacker = player.leader
        if attacker is None:
            return 0.0

        # Find target
        target = opponent.find_card_on_field(action.target_id)
        if target is None and action.target_id == opponent.leader.instance_id:
            target = opponent.leader
        if target is None:
            return 0.0

        # Attacking a character
        if target.card_type != "LEADER":
            if attacker.effective_power >= target.effective_power:
                # Guaranteed KO — score by target value
                return 10.0 + _keyword_score(target) + target.effective_power / 1000.0
            else:
                return -1.0  # Attack will fail, waste of action

        # Attacking leader
        opp_life = len(opponent.life)
        if opp_life == 0:
            # This is the killing blow!
            if attacker.effective_power >= target.effective_power:
                return 100.0
            return -1.0

        score = 1.0

        # Life pressure: more urgent as life drops
        score += 5.0 * (1.0 / max(opp_life, 1))

        # Power advantage check
        power_gap = attacker.effective_power - target.effective_power
        if power_gap < 0:
            return -1.0  # Attack will fail without counter from opponent

        # Counter awareness: penalty if opponent likely counters
        est_counters = self._estimate_opponent_counters(state)
        if est_counters >= power_gap + 1000:
            score -= 2.0

        # Bait bonus: weakest attacker goes first to draw out counters
        active_powers = []
        if player.leader.state == CardState.ACTIVE:
            active_powers.append(player.leader.effective_power)
        for c in player.characters:
            if c.state == CardState.ACTIVE:
                active_powers.append(c.effective_power)

        if (
            len(active_powers) > 1
            and attacker.effective_power == min(active_powers)
        ):
            score += 3.0  # Bait: sacrifice weak attack to drain counters

        return score

    # --- Blocker decision ---

    async def choose_blockers(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> GameCard | None:
        if not blockers:
            return None

        defender = state.defending_player
        life = len(defender.life)

        # If attack will fail anyway, don't block
        if attacker.effective_power < target.effective_power:
            return None

        # Sort blockers by value (lowest first = best to sacrifice)
        sorted_blockers = sorted(blockers, key=lambda b: _keyword_score(b) + b.effective_power / 1000.0)

        if target.card_type == "LEADER":
            if life <= 1:
                # Facing lethal — always block
                return sorted_blockers[0]
            if life <= 2:
                # Block with cheap blocker
                if _keyword_score(sorted_blockers[0]) < 4.0:
                    return sorted_blockers[0]
                return None
            if life >= 4:
                # Life is a resource — don't block, take the hit
                return None
            # life == 3: block only if blocker survives
            for b in sorted_blockers:
                if b.effective_power >= attacker.effective_power:
                    return b
            return None
        else:
            # Character attack — protect high-value targets
            target_value = _keyword_score(target) + target.effective_power / 1000.0
            blocker_value = _keyword_score(sorted_blockers[0]) + sorted_blockers[0].effective_power / 1000.0
            if target_value > blocker_value + 2.0:
                return sorted_blockers[0]
            return None

    # --- Counter decision ---

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

        defender = state.defending_player
        life = len(defender.life)
        counter_cards = [c for c in hand if c.counter > 0]

        if not counter_cards:
            return []

        if target.card_type == "LEADER":
            if life >= 4:
                # Plenty of life — take the hit, keep hand resources
                return []
            if life <= 1:
                # Must counter — facing lethal
                return self._select_counters(counter_cards, power_gap, defender)
            if life <= 2:
                # Counter with low-utility cards only
                low_utility = [
                    c for c in counter_cards
                    if _card_utility(c, defender) < 3.0
                ]
                if low_utility:
                    return self._select_counters(low_utility, power_gap, defender)
                return []
            # life == 3: counter if cheap
            return self._select_counters(counter_cards, power_gap, defender, max_cards=2)
        else:
            # Character attack — counter to protect high-value targets
            target_value = _keyword_score(target) + target.effective_power / 1000.0
            if target_value >= 6.0:
                return self._select_counters(counter_cards, power_gap, defender)
            return []

    def _select_counters(
        self,
        counter_cards: list[GameCard],
        power_gap: int,
        player: PlayerState,
        max_cards: int = 99,
    ) -> list[GameCard]:
        """Pick minimum counters to meet power_gap, discarding lowest utility first."""
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
        # Can't meet gap — don't waste partial counters
        return []
