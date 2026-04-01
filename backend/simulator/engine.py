"""OPTCG Game Engine — pure deterministic state machine.

Implements full OPTCG turn structure and combat resolution.
No LLM calls — decisions come from external agents via callbacks.
"""

from __future__ import annotations

import logging
import random
from typing import Protocol

from .effects import EffectHandler
from .models import (
    ActionType,
    CardState,
    DecisionPoint,
    GameAction,
    GameCard,
    GameResult,
    GameState,
    Phase,
    PlayerState,
    TurnSnapshot,
)

logger = logging.getLogger(__name__)


class Agent(Protocol):
    """Interface for AI agents that make game decisions."""

    async def choose_mulligan(self, hand: list[GameCard]) -> bool:
        """Return True to mulligan (redraw entire hand). One chance only."""
        ...

    async def choose_main_action(
        self, state: GameState, legal_actions: list[GameAction]
    ) -> int:
        """Choose an action index from legal_actions during main phase."""
        ...

    async def choose_blockers(
        self,
        state: GameState,
        blockers: list[GameCard],
        attacker: GameCard,
        target: GameCard,
    ) -> GameCard | None:
        """Choose a blocker to redirect an attack, or None."""
        ...

    async def choose_counters(
        self,
        state: GameState,
        hand: list[GameCard],
        attacker: GameCard,
        target: GameCard,
        power_gap: int,
    ) -> list[GameCard]:
        """Choose cards from hand to play as counters."""
        ...


class GameEngine:
    """Pure OPTCG game engine — stateful, deterministic given same RNG seed."""

    def __init__(self, seed: int | None = None) -> None:
        self.rng = random.Random(seed)
        self.effects = EffectHandler(self.rng)
        self.state: GameState = None  # type: ignore[assignment]
        self._cards_played_p1: dict[str, int] = {}
        self._cards_played_p2: dict[str, int] = {}
        # Enhanced data collection
        self._cards_drawn_p1: dict[str, int] = {}
        self._cards_drawn_p2: dict[str, int] = {}
        self._damage_p1: int = 0  # Life cards taken from P2
        self._damage_p2: int = 0  # Life cards taken from P1
        self._effects_p1: int = 0
        self._effects_p2: int = 0
        self._p1_mulligan: bool = False
        self._p2_mulligan: bool = False
        self._win_condition: str = ""
        self._turn_snapshots: list[TurnSnapshot] = []
        self.decision_points: list[DecisionPoint] = []
        self._cards_koed: dict[str, int] = {}  # card_id -> times KO'd
        self._cards_countered: dict[str, int] = {}  # card_id -> times used as counter
        self._cards_blocked: dict[str, int] = {}  # card_id -> times used as blocker
        self._card_play_turns: dict[str, list[int]] = {}  # card_id -> [turn played]

    def init_game(
        self,
        p1_leader: GameCard,
        p1_deck: list[GameCard],
        p2_leader: GameCard,
        p2_deck: list[GameCard],
        starting_life: int = 5,
    ) -> GameState:
        """Initialize a new game with two players."""
        # Shuffle decks
        self.rng.shuffle(p1_deck)
        self.rng.shuffle(p2_deck)

        p1 = PlayerState(
            player_id="p1",
            leader=p1_leader,
            deck=p1_deck,
        )
        p2 = PlayerState(
            player_id="p2",
            leader=p2_leader,
            deck=p2_deck,
        )

        # Set life cards (top N from deck, face-down)
        for player in (p1, p2):
            for _ in range(starting_life):
                if player.deck:
                    player.life.append(player.deck.pop(0))

        # Draw starting hands (5 cards each)
        for player in (p1, p2):
            for _ in range(5):
                if player.deck:
                    player.hand.append(player.deck.pop(0))

        # Coin flip for who goes first
        first = self.rng.choice(["p1", "p2"])
        self.state = GameState(
            p1=p1,
            p2=p2,
            turn=0,
            active_player_id=first,
            first_player_id=first,
        )
        self.state.log("system", "setup", "game_initialized", first_player=first)
        self._cards_played_p1 = {}
        self._cards_played_p2 = {}
        self._cards_drawn_p1 = {}
        self._cards_drawn_p2 = {}
        self._damage_p1 = 0
        self._damage_p2 = 0
        self._effects_p1 = 0
        self._effects_p2 = 0
        self._p1_mulligan = False
        self._p2_mulligan = False
        self._win_condition = ""
        self._turn_snapshots = []
        self.decision_points = []
        self._cards_koed = {}
        self._cards_countered = {}
        self._cards_blocked = {}
        self._card_play_turns = {}

        return self.state

    async def run_game(self, p1_agent: Agent, p2_agent: Agent) -> GameResult:
        """Run a complete game, returning the result."""
        if self.state is None:
            raise RuntimeError("Game not initialized. Call init_game() first.")

        # Wire decision collectors to agents (if they support it)
        for agent in (p1_agent, p2_agent):
            if hasattr(agent, "set_decision_collector"):
                agent.set_decision_collector(self.decision_points)  # type: ignore[union-attr]

        # Mulligan phase — each player gets one chance to redraw
        await self._mulligan_phase(p1_agent, p2_agent)

        agents = {"p1": p1_agent, "p2": p2_agent}

        while not self.state.is_game_over():
            self.state.turn += 1
            first = self.state.first_player_id
            second = "p2" if first == "p1" else "p1"
            self.state.active_player_id = first if self.state.turn % 2 == 1 else second
            agent = agents[self.state.active_player_id]

            # Run phases before logging so status reflects playable state
            self._refresh_phase()
            self._draw_phase()
            self._don_phase()

            # Capture turn snapshot for timeline analysis
            self._turn_snapshots.append(
                TurnSnapshot(
                    turn=self.state.turn,
                    active_player=self.state.active_player_id,
                    p1_life=len(self.state.p1.life),
                    p2_life=len(self.state.p2.life),
                    p1_hand_size=len(self.state.p1.hand),
                    p2_hand_size=len(self.state.p2.hand),
                    p1_field_count=len(self.state.p1.field),
                    p2_field_count=len(self.state.p2.field),
                    p1_field_power=sum(
                        c.effective_power for c in self.state.p1.characters
                    ),
                    p2_field_power=sum(
                        c.effective_power for c in self.state.p2.characters
                    ),
                    p1_don_available=self.state.p1.don_field,
                    p2_don_available=self.state.p2.don_field,
                    p1_deck_remaining=len(self.state.p1.deck),
                    p2_deck_remaining=len(self.state.p2.deck),
                    p1_board_eval=self._quick_board_eval("p1"),
                    p2_board_eval=self._quick_board_eval("p2"),
                )
            )

            # Log turn start AFTER refresh/draw/DON so DON values are accurate
            self.state.log(
                self.state.active_player_id,
                "turn",
                "start",
                turn=self.state.turn,
                # Hand details with card info for board replay
                p1_hand=[
                    {
                        "name": c.name,
                        "card_id": c.card_id,
                        "image": c.image,
                        "cost": c.cost,
                        "power": c.power,
                        "counter": c.counter,
                        "card_type": c.card_type,
                        "ability": c.ability_text,
                    }
                    for c in self.state.p1.hand
                ],
                p2_hand=[
                    {
                        "name": c.name,
                        "card_id": c.card_id,
                        "image": c.image,
                        "cost": c.cost,
                        "power": c.power,
                        "counter": c.counter,
                        "card_type": c.card_type,
                        "ability": c.ability_text,
                    }
                    for c in self.state.p2.hand
                ],
                p1_life=len(self.state.p1.life),
                p2_life=len(self.state.p2.life),
                p1_field=[c.name for c in self.state.p1.field],
                p2_field=[c.name for c in self.state.p2.field],
                p1_don=self.state.p1.don_field,
                p2_don=self.state.p2.don_field,
                p1_don_rested=self.state.p1.don_rested,
                p2_don_rested=self.state.p2.don_rested,
                p1_don_attached=sum(c.attached_don for c in self.state.p1.field)
                + self.state.p1.leader.attached_don,
                p2_don_attached=sum(c.attached_don for c in self.state.p2.field)
                + self.state.p2.leader.attached_don,
                p1_don_deck=self.state.p1.don_deck,
                p2_don_deck=self.state.p2.don_deck,
                # Leader details with image
                p1_leader={
                    "name": self.state.p1.leader.name,
                    "card_id": self.state.p1.leader.card_id,
                    "image": self.state.p1.leader.image,
                    "power": self.state.p1.leader.effective_power,
                    "don": self.state.p1.leader.attached_don,
                    "state": self.state.p1.leader.state.value,
                    "ability": self.state.p1.leader.ability_text,
                },
                p2_leader={
                    "name": self.state.p2.leader.name,
                    "card_id": self.state.p2.leader.card_id,
                    "image": self.state.p2.leader.image,
                    "power": self.state.p2.leader.effective_power,
                    "don": self.state.p2.leader.attached_don,
                    "state": self.state.p2.leader.state.value,
                    "ability": self.state.p2.leader.ability_text,
                },
                # Field details with images
                p1_field_details=[
                    {
                        "name": c.name,
                        "card_id": c.card_id,
                        "image": c.image,
                        "power": c.effective_power,
                        "state": c.state.value,
                        "don": c.attached_don,
                        "card_type": c.card_type,
                        "cost": c.cost,
                        "ability": c.ability_text,
                    }
                    for c in self.state.p1.field
                ],
                p2_field_details=[
                    {
                        "name": c.name,
                        "card_id": c.card_id,
                        "image": c.image,
                        "power": c.effective_power,
                        "state": c.state.value,
                        "don": c.attached_don,
                        "card_type": c.card_type,
                        "cost": c.cost,
                        "ability": c.ability_text,
                    }
                    for c in self.state.p2.field
                ],
                # Trash counts
                p1_trash=len(self.state.p1.trash),
                p2_trash=len(self.state.p2.trash),
            )
            await self._main_phase(agent, agents)
            self._end_phase()

            # Check deck-out
            if not self.state.active_player.deck:
                self.state.winner = self.state.defending_player.player_id
                self._win_condition = "deck_out"
                self.state.log(self.state.active_player_id, "game", "deck_out")

        if self.state.winner is None:
            self.state.winner = "draw"
            if not self._win_condition:
                self._win_condition = "timeout"

        return GameResult(
            winner=self.state.winner,
            turns=self.state.turn,
            p1_life_remaining=len(self.state.p1.life),
            p2_life_remaining=len(self.state.p2.life),
            first_player=self.state.first_player_id,
            p1_cards_played=dict(self._cards_played_p1),
            p2_cards_played=dict(self._cards_played_p2),
            game_log=[e.to_dict() for e in self.state.game_log],
            decision_points=list(self.decision_points),
            turn_snapshots=list(self._turn_snapshots),
            p1_mulligan=self._p1_mulligan,
            p2_mulligan=self._p2_mulligan,
            win_condition=self._win_condition,
            p1_total_damage_dealt=self._damage_p1,
            p2_total_damage_dealt=self._damage_p2,
            p1_effects_fired=self._effects_p1,
            p2_effects_fired=self._effects_p2,
        )

    # --- Phase implementations ---

    async def _mulligan_phase(self, p1_agent: Agent, p2_agent: Agent) -> None:
        """Each player gets one chance to mulligan (redraw entire hand).

        OPTCG rule: return all cards to deck, shuffle, draw 5 new cards.
        """
        for player_id, agent in [("p1", p1_agent), ("p2", p2_agent)]:
            player = self.state.p1 if player_id == "p1" else self.state.p2
            opponent = self.state.p2 if player_id == "p1" else self.state.p1
            did_mulligan = await agent.choose_mulligan(list(player.hand))

            # Log mulligan decision
            self.decision_points.append(
                DecisionPoint(
                    turn=0,
                    phase="mulligan",
                    player_id=player_id,
                    player_life=len(player.life),
                    opponent_life=len(opponent.life),
                    player_hand_size=len(player.hand),
                    player_field_power=0,
                    player_don_available=0,
                    opponent_field_power=0,
                    opponent_hand_size=len(opponent.hand),
                    num_legal_actions=2,
                    action_scores=[],
                    chosen_action_index=1 if did_mulligan else 0,
                    chosen_action_type="mulligan" if did_mulligan else "keep",
                    chosen_action_desc="Mulligan hand" if did_mulligan else "Keep hand",
                )
            )

            if did_mulligan:
                player.deck.extend(player.hand)
                player.hand.clear()
                self.rng.shuffle(player.deck)
                for _ in range(5):
                    if player.deck:
                        player.hand.append(player.deck.pop(0))
                if player_id == "p1":
                    self._p1_mulligan = True
                else:
                    self._p2_mulligan = True
                self.state.log(player_id, "setup", "mulligan")

    def _refresh_phase(self) -> None:
        """Unrest all cards, detach DON!! back to field, reset power mods."""
        self.state.phase = Phase.REFRESH
        player = self.state.active_player
        opponent = self.state.defending_player

        # Return rested DON!! (spent on card costs) back to active pool
        player.don_field += player.don_rested
        player.don_rested = 0

        # Unrest leader
        player.leader.state = CardState.ACTIVE
        player.leader.reset_turn_modifiers()

        # Unrest all field cards, return attached DON!! to pool, clear summoning sickness
        for card in player.field:
            card.state = CardState.ACTIVE
            card.can_attack = True  # Summoning sickness wears off
            player.don_field += card.attached_don
            card.attached_don = 0
            card.reset_turn_modifiers()

        # Also return DON!! from leader
        player.don_field += player.leader.attached_don
        player.leader.attached_don = 0

        # Resolve passive Stage effects (activated each turn while on field)
        for stage in player.stages:
            self.effects.resolve_passive(self, stage, player, opponent)

    def _draw_phase(self) -> None:
        """Draw 1 card (skip turn 1 for P1)."""
        self.state.phase = Phase.DRAW

        # P1 skips draw on turn 1
        if self.state.turn == 1:
            return

        player = self.state.active_player
        if player.deck:
            card = player.deck.pop(0)
            player.hand.append(card)
            # Track times drawn
            tracker = (
                self._cards_drawn_p1
                if player.player_id == "p1"
                else self._cards_drawn_p2
            )
            tracker[card.card_id] = tracker.get(card.card_id, 0) + 1
            self.state.log(player.player_id, "draw", "draw_card", card_name=card.name)

    def _don_phase(self) -> None:
        """Add DON!! from DON deck to field (max 10 total)."""
        self.state.phase = Phase.DON
        player = self.state.active_player

        total_don_on_board = (
            player.don_field
            + player.don_rested
            + sum(c.attached_don for c in player.field)
            + player.leader.attached_don
        )

        don_per_turn = 1 if self.state.turn == 1 else 2
        don_to_add = min(don_per_turn, player.don_deck, 10 - total_don_on_board)
        if don_to_add > 0:
            player.don_deck -= don_to_add
            player.don_field += don_to_add
            self.state.log(
                player.player_id,
                "don",
                "add_don",
                amount=don_to_add,
                total=player.don_field,
            )

    async def _main_phase(self, agent: Agent, agents: dict[str, Agent]) -> None:
        """Main phase — agent chooses actions until pass."""
        self.state.phase = Phase.MAIN
        max_actions = 50  # Safety limit per turn

        for _ in range(max_actions):
            if self.state.is_game_over():
                break

            legal = self._get_legal_actions()
            if not legal:
                break

            choice = await agent.choose_main_action(self.state, legal)
            choice = max(0, min(choice, len(legal) - 1))
            action = legal[choice]

            if action.action_type == ActionType.PASS:
                self.state.log(self.state.active_player_id, "main", "pass")
                break

            await self._execute_action(action, agents)

    def _end_phase(self) -> None:
        """Cleanup at end of turn."""
        self.state.phase = Phase.END
        # Reset all temporary power modifiers for both players
        for player in (self.state.p1, self.state.p2):
            player.leader.reset_turn_modifiers()
            for card in player.field:
                card.reset_turn_modifiers()

    # --- Action computation ---

    def _get_legal_actions(self) -> list[GameAction]:
        """Compute all legal actions for the active player."""
        player = self.state.active_player
        opponent = self.state.defending_player
        actions: list[GameAction] = []

        # Play cards from hand (must match leader color and be affordable)
        leader_colors = set(player.leader.colors) if player.leader.colors else set()
        for card in player.hand:
            if card.card_type not in ("CHARACTER", "EVENT", "STAGE"):
                continue
            if card.cost > player.don_field:
                continue
            # Stage limit: max 1 Stage per player (OPTCG rule)
            if card.card_type == "STAGE" and player.stages:
                continue
            # Color restriction: card must share at least one color with leader
            # Skip check if leader or card has no color data (backward compat)
            if leader_colors and card.colors:
                if not leader_colors.intersection(card.colors):
                    continue
            actions.append(
                GameAction(
                    action_type=ActionType.PLAY_CARD,
                    source_id=card.instance_id,
                    description=f"Play {card.name} (cost {card.cost})",
                )
            )

        # Attach DON!! to characters or leader
        if player.don_field > 0:
            # To leader
            actions.append(
                GameAction(
                    action_type=ActionType.ATTACH_DON,
                    target_id=player.leader.instance_id,
                    description=f"Attach DON to {player.leader.name} (+1000, now {player.leader.effective_power + 1000})",
                )
            )
            # To active characters
            for card in player.characters:
                actions.append(
                    GameAction(
                        action_type=ActionType.ATTACH_DON,
                        target_id=card.instance_id,
                        description=f"Attach DON to {card.name} (+1000, now {card.effective_power + 1000})",
                    )
                )

        # Attack with leader or active characters that can attack
        # First player cannot attack on turn 1 (OPTCG rule)
        turn_can_attack = self.state.turn > 1
        attack_sources = []
        if turn_can_attack:
            if player.leader.state == CardState.ACTIVE:
                attack_sources.append(player.leader)
            for card in player.characters:
                if (
                    card.state == CardState.ACTIVE
                    and card.can_attack  # No summoning sickness
                    and card.effective_power > 0
                ):
                    attack_sources.append(card)

        for attacker in attack_sources:
            # Can attack opponent's leader
            actions.append(
                GameAction(
                    action_type=ActionType.ATTACK,
                    source_id=attacker.instance_id,
                    target_id=opponent.leader.instance_id,
                    description=f"Attack Leader with {attacker.name} ({attacker.effective_power} vs {opponent.leader.effective_power})",
                )
            )
            # Can attack opponent's rested characters
            for target in opponent.characters:
                if target.state == CardState.RESTED:
                    actions.append(
                        GameAction(
                            action_type=ActionType.ATTACK,
                            source_id=attacker.instance_id,
                            target_id=target.instance_id,
                            description=f"Attack {target.name} with {attacker.name} ({attacker.effective_power} vs {target.effective_power})",
                        )
                    )

        # Always can pass
        actions.append(
            GameAction(
                action_type=ActionType.PASS,
                description="Pass (end main phase)",
            )
        )

        if len(actions) <= 1:
            logger.warning(
                "Turn %d %s: only PASS available. don=%d hand=%d field=%d leader_colors=%s",
                self.state.turn,
                player.player_id,
                player.don_field,
                len(player.hand),
                len(player.field),
                list(leader_colors),
            )

        return actions

    async def _execute_action(
        self, action: GameAction, agents: dict[str, Agent]
    ) -> None:
        """Execute a chosen action."""
        player = self.state.active_player
        opponent = self.state.defending_player

        if action.action_type == ActionType.PLAY_CARD:
            await self._play_card(action, player, opponent)
        elif action.action_type == ActionType.ATTACH_DON:
            self._attach_don(action, player)
        elif action.action_type == ActionType.ATTACK:
            await self._resolve_attack(action, player, opponent, agents)

    async def _play_card(
        self, action: GameAction, player: PlayerState, opponent: PlayerState
    ) -> None:
        """Play a card from hand to field."""
        card = player.find_card_in_hand(action.source_id)
        if not card:
            return

        # Pay cost — DON!! are rested (not consumed), return at next refresh
        if card.cost > player.don_field:
            return
        player.don_field -= card.cost
        player.don_rested += card.cost

        player.hand.remove(card)

        if card.card_type == "EVENT":
            # Events resolve and go to trash
            self.effects.resolve_on_play(self, card, player, opponent)
            player.trash.append(card)
            self.state.log(
                player.player_id,
                "main",
                "play_event",
                card_name=card.name,
                card_image=card.image,
                cost=card.cost,
            )
        else:
            # Characters and Stages go to field ACTIVE but with summoning sickness
            card.state = CardState.ACTIVE
            card.can_attack = False  # Summoning sickness — can't attack this turn
            if self.effects.has_rush(card):
                card.can_attack = True  # Rush bypasses summoning sickness
            player.field.append(card)
            self.effects.resolve_on_play(self, card, player, opponent)
            self.state.log(
                player.player_id,
                "main",
                "play_card",
                card_name=card.name,
                card_image=card.image,
                cost=card.cost,
                card_type=card.card_type,
            )

        # Track cards played + turn timing
        tracker = (
            self._cards_played_p1 if player.player_id == "p1" else self._cards_played_p2
        )
        tracker[card.card_id] = tracker.get(card.card_id, 0) + 1
        self._card_play_turns.setdefault(card.card_id, []).append(self.state.turn)

    def _attach_don(self, action: GameAction, player: PlayerState) -> None:
        """Attach 1 DON!! from field pool to a card."""
        if player.don_field <= 0:
            return

        target = player.find_card_on_field(action.target_id)
        if target is None and action.target_id == player.leader.instance_id:
            target = player.leader

        if target is None:
            return

        player.don_field -= 1
        target.attached_don += 1
        self.state.log(
            player.player_id,
            "main",
            "attach_don",
            card_name=self._card_label(target, player),
            new_power=target.effective_power,
        )

    async def _resolve_attack(
        self,
        action: GameAction,
        attacker_player: PlayerState,
        defender_player: PlayerState,
        agents: dict[str, Agent],
    ) -> None:
        """Full combat resolution with blocker/counter steps."""
        attacker = attacker_player.find_card_on_field(action.source_id)
        if attacker is None and action.source_id == attacker_player.leader.instance_id:
            attacker = attacker_player.leader
        if attacker is None:
            return

        target = defender_player.find_card_on_field(action.target_id)
        if target is None and action.target_id == defender_player.leader.instance_id:
            target = defender_player.leader
        if target is None:
            return

        # Rest attacker
        attacker.state = CardState.RESTED

        # When Attacking effects (resolve BEFORE logging so declared power is accurate)
        self.effects.resolve_when_attacking(
            self, attacker, attacker_player, defender_player
        )

        # Build display labels — disambiguate same-named cards (e.g. Leader vs Character)
        attacker_label = self._card_label(attacker, attacker_player)
        target_label = self._card_label(target, defender_player)

        self.state.log(
            attacker_player.player_id,
            "combat",
            "attack_declared",
            attacker=attacker_label,
            target=target_label,
            attacker_power=attacker.effective_power,
            target_power=target.effective_power,
        )

        # Blocker window
        defender_agent = agents[defender_player.player_id]
        available_blockers = [
            c
            for c in defender_player.characters
            if self.effects.has_blocker(c)
            and c.state == CardState.ACTIVE
            and c.instance_id != target.instance_id
        ]

        if available_blockers:
            blocker = await defender_agent.choose_blockers(
                self.state, available_blockers, attacker, target
            )
            if blocker and blocker in available_blockers:
                target = blocker
                blocker.state = CardState.RESTED
                self._cards_blocked[blocker.card_id] = (
                    self._cards_blocked.get(blocker.card_id, 0) + 1
                )
                self.state.log(
                    defender_player.player_id,
                    "combat",
                    "blocker_used",
                    blocker=blocker.name,
                )
                # Resolve "When Blocking" effects
                self.effects.resolve_on_block(
                    self, blocker, defender_player, attacker_player
                )

        # Counter step
        power_gap = attacker.effective_power - target.effective_power
        counter_cards = await defender_agent.choose_counters(
            self.state, defender_player.hand, attacker, target, power_gap
        )

        counter_total = 0
        for ccard in counter_cards:
            if ccard in defender_player.hand:
                counter_total += ccard.counter
                defender_player.hand.remove(ccard)
                defender_player.trash.append(ccard)
                self._cards_countered[ccard.card_id] = (
                    self._cards_countered.get(ccard.card_id, 0) + 1
                )
                self.state.log(
                    defender_player.player_id,
                    "combat",
                    "counter_played",
                    card_name=ccard.name,
                    counter_value=ccard.counter,
                )

        defense_power = target.effective_power + counter_total

        # Power check
        if attacker.effective_power >= defense_power:
            # Attack succeeds
            if target == defender_player.leader:
                # Track damage dealt
                if attacker_player.player_id == "p1":
                    self._damage_p1 += 1
                else:
                    self._damage_p2 += 1
                self._deal_life_damage(attacker, defender_player, attacker_player)
                # Double Attack
                if self.effects.has_double_attack(attacker) and defender_player.life:
                    if attacker_player.player_id == "p1":
                        self._damage_p1 += 1
                    else:
                        self._damage_p2 += 1
                    self._deal_life_damage(attacker, defender_player, attacker_player)
            else:
                # KO the character
                self._cards_koed[target.card_id] = (
                    self._cards_koed.get(target.card_id, 0) + 1
                )
                self.effects.resolve_on_ko(
                    self, target, defender_player, attacker_player
                )
                defender_player.field.remove(target)
                if self.effects.has_banish(target):
                    defender_player.deck.append(target)
                else:
                    defender_player.trash.append(target)
                # Return attached DON!! to owner's pool (OPTCG rule)
                defender_player.don_field += target.attached_don
                target.attached_don = 0
                target.power_modifier = 0
                self.state.log(
                    defender_player.player_id,
                    "combat",
                    "character_koed",
                    card_name=target.name,
                )
        else:
            self.state.log(
                attacker_player.player_id,
                "combat",
                "attack_failed",
                attacker=attacker_label,
                attack_power=attacker.effective_power,
                defense_power=defense_power,
            )

    def _deal_life_damage(
        self, attacker: GameCard, defender: PlayerState, attacker_player: PlayerState
    ) -> None:
        """Remove a life card and check for trigger/game over."""
        if not defender.life:
            # No life left — this attack wins the game
            self.state.winner = attacker_player.player_id
            self._win_condition = "lethal"
            self.state.log(
                attacker_player.player_id,
                "combat",
                "final_blow",
                attacker=attacker.name,
            )
            return

        life_card = defender.life.pop(0)
        defender.hand.append(life_card)  # Life card goes to hand
        self.state.log(
            defender.player_id,
            "combat",
            "life_lost",
            remaining=len(defender.life),
            trigger=life_card.trigger_effect or "none",
            card_name=life_card.name,
            card_image=life_card.image,
            card_id=life_card.card_id,
            card_cost=life_card.cost,
            card_power=life_card.power,
            card_counter=life_card.counter,
            card_type=life_card.card_type,
        )

        # Resolve trigger effect
        if life_card.trigger_effect:
            opponent = self.state.p1 if defender.player_id == "p2" else self.state.p2
            self.effects.resolve_trigger(self, life_card, defender, opponent)

    # --- Data collection helpers ---

    def _quick_board_eval(self, player_id: str) -> float:
        """Lightweight board evaluation for TurnSnapshot (no imports needed)."""
        player = self.state.p1 if player_id == "p1" else self.state.p2
        opponent = self.state.p2 if player_id == "p1" else self.state.p1
        score = 0.0
        score += len(player.life) * 100.0
        score -= len(opponent.life) * 100.0
        score += len(player.hand) * 15.0
        score -= len(opponent.hand) * 8.0
        score += sum(c.effective_power for c in player.characters) * 0.003
        score -= sum(c.effective_power for c in opponent.characters) * 0.003
        score += player.don_field * 8.0
        score += len(player.characters) * 12.0
        score -= len(opponent.characters) * 12.0
        return round(score, 1)

    def track_effect_fired(self, player_id: str) -> None:
        """Increment effect counter for a player (called by EffectHandler)."""
        if player_id == "p1":
            self._effects_p1 += 1
        else:
            self._effects_p2 += 1

    # --- Utility ---

    def _card_label(self, card: GameCard, owner: PlayerState) -> str:
        """Build a display label that disambiguates same-named cards.

        If a character shares a name with the owner's leader, append the card
        type to avoid confusion in the game log (e.g. "Yamato" vs "Yamato (Leader)").
        """
        if card.card_type == "LEADER":
            # Check if any field character shares the leader's name
            if any(c.name == card.name for c in owner.field):
                return f"{card.name} (Leader)"
        elif card.name == owner.leader.name:
            return f"{card.name} (Character)"
        return card.name

    def get_game_summary(self, perspective: str = "p1") -> str:
        """Generate a human-readable game state summary for AI agents."""
        player = self.state.p1 if perspective == "p1" else self.state.p2
        opponent = self.state.p2 if perspective == "p1" else self.state.p1

        lines = [
            f"Turn {self.state.turn} | Phase: {self.state.phase.value}",
            f"Your life: {len(player.life)} | Opponent life: {len(opponent.life)}",
            f"DON available: {player.don_field} | DON rested: {player.don_rested} | DON deck: {player.don_deck}",
            f"Hand ({len(player.hand)} cards):",
        ]

        for i, card in enumerate(player.hand):
            kw = ", ".join(card.keywords) if card.keywords else ""
            lines.append(
                f"  [{i}] {card.name} (Cost:{card.cost} P:{card.power}"
                f"{' ' + kw if kw else ''})"
            )

        lines.append(f"Your field ({len(player.field)} cards):")
        lines.append(
            f"  Leader: {player.leader.name} P:{player.leader.effective_power} "
            f"{'ACTIVE' if player.leader.state == CardState.ACTIVE else 'RESTED'}"
            f"{' DON:' + str(player.leader.attached_don) if player.leader.attached_don else ''}"
        )
        for card in player.field:
            lines.append(
                f"  {card.name} P:{card.effective_power} "
                f"{'ACTIVE' if card.state == CardState.ACTIVE else 'RESTED'}"
                f"{' DON:' + str(card.attached_don) if card.attached_don else ''}"
                f"{' [Blocker]' if self.effects.has_blocker(card) else ''}"
            )

        lines.append(f"Opponent field ({len(opponent.field)} cards):")
        lines.append(
            f"  Leader: {opponent.leader.name} P:{opponent.leader.effective_power}"
        )
        for card in opponent.field:
            lines.append(
                f"  {card.name} P:{card.effective_power} "
                f"{'ACTIVE' if card.state == CardState.ACTIVE else 'RESTED'}"
                f"{' [Blocker]' if self.effects.has_blocker(card) else ''}"
            )

        return "\n".join(lines)
