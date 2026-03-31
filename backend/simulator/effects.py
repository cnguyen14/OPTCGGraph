"""Keyword-based effect resolution for the OPTCG simulator.

Approximates card abilities using parsed keywords rather than implementing
every unique card text. This is sufficient for simulation accuracy.
"""

from __future__ import annotations

import logging
import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .engine import GameEngine

from .models import CardState, GameCard, PlayerState

logger = logging.getLogger(__name__)


class EffectHandler:
    """Resolves keyword-based effects during gameplay."""

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()

    def resolve_on_play(
        self, engine: GameEngine, card: GameCard, player: PlayerState, opponent: PlayerState
    ) -> None:
        """Resolve effects when a card enters the field."""
        keywords = [k.lower() for k in card.keywords]

        if "draw" in keywords:
            self._draw(engine, player, 1)

        if "search" in keywords:
            self._search(engine, player)

        if "bounce" in keywords:
            self._bounce_lowest(engine, opponent)

        if "ko" in keywords:
            self._ko_weakest(engine, card, opponent)

        if "trash" in keywords:
            self._trash_from_hand(engine, opponent)

        if "rest" in keywords:
            self._rest_opponent(engine, opponent)

        if "power buff" in keywords or "buff" in keywords:
            card.power_modifier += 2000

        if "power debuff" in keywords or "debuff" in keywords:
            self._debuff_opponent(engine, opponent, -2000)

    def resolve_when_attacking(
        self, engine: GameEngine, card: GameCard, player: PlayerState, opponent: PlayerState
    ) -> None:
        """Resolve 'When Attacking' effects."""
        keywords = [k.lower() for k in card.keywords]

        if "draw" in keywords and card.card_type == "LEADER":
            self._draw(engine, player, 1)

        if "power buff" in keywords or "buff" in keywords:
            card.power_modifier += 1000

    def resolve_on_ko(
        self, engine: GameEngine, card: GameCard, player: PlayerState, opponent: PlayerState
    ) -> None:
        """Resolve 'On K.O.' effects."""
        keywords = [k.lower() for k in card.keywords]

        if "draw" in keywords:
            self._draw(engine, player, 1)

    def resolve_trigger(
        self, engine: GameEngine, card: GameCard, player: PlayerState, opponent: PlayerState
    ) -> None:
        """Resolve trigger effects when a life card is revealed."""
        if not card.trigger_effect:
            return

        trigger_lower = card.trigger_effect.lower()

        if "draw" in trigger_lower:
            self._draw(engine, player, 1)
        elif "rest" in trigger_lower:
            self._rest_opponent(engine, opponent)
        elif "play" in trigger_lower:
            # Trigger: play a low-cost character from hand
            self._trigger_play(engine, player)

    def has_keyword(self, card: GameCard, keyword: str) -> bool:
        return keyword.lower() in [k.lower() for k in card.keywords]

    def has_rush(self, card: GameCard) -> bool:
        return self.has_keyword(card, "rush")

    def has_blocker(self, card: GameCard) -> bool:
        return self.has_keyword(card, "blocker")

    def has_double_attack(self, card: GameCard) -> bool:
        return self.has_keyword(card, "double attack")

    def has_banish(self, card: GameCard) -> bool:
        return self.has_keyword(card, "banish")

    # --- Internal effect implementations ---

    def _draw(self, engine: GameEngine, player: PlayerState, count: int) -> None:
        for _ in range(count):
            if player.deck:
                card = player.deck.pop(0)
                player.hand.append(card)
                engine.state.log(
                    player.player_id, "effect", "draw", card_name=card.name
                )

    def _search(self, engine: GameEngine, player: PlayerState) -> None:
        """Look at top 5 cards, add best one to hand."""
        if not player.deck:
            return
        top = player.deck[:5]
        if not top:
            return
        # Pick highest cost card from top 5
        best = max(top, key=lambda c: c.cost)
        player.deck.remove(best)
        player.hand.append(best)
        self.rng.shuffle(player.deck[:4])  # Shuffle remaining top cards back
        engine.state.log(
            player.player_id, "effect", "search", card_name=best.name
        )

    def _bounce_lowest(self, engine: GameEngine, opponent: PlayerState) -> None:
        """Return opponent's lowest-cost character to hand."""
        chars = opponent.characters
        if not chars:
            return
        lowest = min(chars, key=lambda c: c.cost)
        opponent.field.remove(lowest)
        lowest.state = CardState.ACTIVE
        # Return attached DON!! to owner's pool (OPTCG rule)
        opponent.don_field += lowest.attached_don
        lowest.attached_don = 0
        lowest.power_modifier = 0
        opponent.hand.append(lowest)
        engine.state.log(
            opponent.player_id, "effect", "bounced", card_name=lowest.name
        )

    def _ko_weakest(
        self, engine: GameEngine, source: GameCard, opponent: PlayerState
    ) -> None:
        """KO opponent's character with power <= source cost * 1000."""
        threshold = source.cost * 1000
        targets = [c for c in opponent.characters if c.effective_power <= threshold]
        if not targets:
            return
        target = min(targets, key=lambda c: c.effective_power)
        opponent.field.remove(target)
        # Return attached DON!! to owner's pool (OPTCG rule)
        opponent.don_field += target.attached_don
        target.attached_don = 0
        target.power_modifier = 0
        opponent.trash.append(target)
        engine.state.log(
            opponent.player_id, "effect", "ko", card_name=target.name
        )

    def _trash_from_hand(self, engine: GameEngine, opponent: PlayerState) -> None:
        """Opponent discards 1 card from hand (random)."""
        if not opponent.hand:
            return
        card = self.rng.choice(opponent.hand)
        opponent.hand.remove(card)
        opponent.trash.append(card)
        engine.state.log(
            opponent.player_id, "effect", "trashed", card_name=card.name
        )

    def _rest_opponent(self, engine: GameEngine, opponent: PlayerState) -> None:
        """Rest 1 opponent character."""
        active_chars = [c for c in opponent.characters if c.state == CardState.ACTIVE]
        if not active_chars:
            return
        target = self.rng.choice(active_chars)
        target.state = CardState.RESTED
        engine.state.log(
            opponent.player_id, "effect", "rested", card_name=target.name
        )

    def _debuff_opponent(
        self, engine: GameEngine, opponent: PlayerState, amount: int
    ) -> None:
        """Apply power debuff to opponent's strongest character."""
        chars = opponent.characters
        if not chars:
            return
        target = max(chars, key=lambda c: c.effective_power)
        target.power_modifier += amount
        engine.state.log(
            opponent.player_id, "effect", "debuffed",
            card_name=target.name, amount=amount,
        )

    def _trigger_play(self, engine: GameEngine, player: PlayerState) -> None:
        """Play a low-cost character from hand for free (trigger effect)."""
        playable = [
            c for c in player.hand
            if c.card_type == "CHARACTER" and c.cost <= 3
        ]
        if not playable:
            return
        card = max(playable, key=lambda c: c.cost)
        player.hand.remove(card)
        card.state = CardState.RESTED  # Enters rested
        player.field.append(card)
        engine.state.log(
            player.player_id, "effect", "trigger_play", card_name=card.name
        )
