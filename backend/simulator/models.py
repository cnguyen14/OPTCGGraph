"""Data models for the OPTCG battle simulator."""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from enum import Enum
from typing import Any


class Phase(str, Enum):
    REFRESH = "refresh"
    DRAW = "draw"
    DON = "don"
    MAIN = "main"
    COUNTER = "counter"
    END = "end"


class CardState(str, Enum):
    ACTIVE = "active"
    RESTED = "rested"


class ActionType(str, Enum):
    PLAY_CARD = "play_card"
    ATTACH_DON = "attach_don"
    ATTACK = "attack"
    USE_BLOCKER = "use_blocker"
    PLAY_COUNTER = "play_counter"
    PASS = "pass"


class EffectTrigger(str, Enum):
    ON_PLAY = "on_play"
    ON_ATTACK = "on_attack"
    ON_BLOCK = "on_block"
    ON_KO = "on_ko"
    TRIGGER = "trigger"  # Life card trigger
    PASSIVE = "passive"  # Always active while on field (e.g. Stage effects)


class EffectType(str, Enum):
    KO = "ko"
    BOUNCE = "bounce"
    DRAW = "draw"
    SEARCH = "search"
    TRASH_FROM_HAND = "trash_from_hand"
    REST = "rest"
    POWER_BOOST = "power_boost"
    POWER_REDUCE = "power_reduce"
    PLAY_FROM_TRASH = "play_from_trash"
    DON_MINUS = "don_minus"
    BOTTOM_DECK = "bottom_deck"
    PROTECT = "protect"
    COST_REDUCE = "cost_reduce"
    EXTRA_DON = "extra_don"
    BLOCKER = "blocker"
    RUSH = "rush"
    DOUBLE_ATTACK = "double_attack"
    BANISH = "banish"
    ON_KO_DRAW = "on_ko_draw"
    TRIGGER_PLAY = "trigger_play"


@dataclass
class EffectCondition:
    """Conditions that must be met for an effect to resolve."""

    power_lte: int | None = None  # Target power <= value
    power_gte: int | None = None  # Target power >= value
    cost_lte: int | None = None  # Target cost <= value
    cost_gte: int | None = None  # Target cost >= value
    card_type: str | None = None  # Target must be this type
    color: str | None = None  # Target must be this color
    is_active: bool | None = None  # Target must be active/rested
    source_cost_multiplier: int | None = None  # power_lte = source.cost * multiplier


@dataclass
class EffectTemplate:
    """Parameterized effect definition — replaces hardcoded keyword logic.

    Examples:
        KO with condition:  EffectTemplate(type=KO, trigger=ON_PLAY, target="opponent_character",
                                           condition=EffectCondition(power_lte=5000), count=1)
        Draw on attack:     EffectTemplate(type=DRAW, trigger=ON_ATTACK, amount=1)
        Blocker (passive):  EffectTemplate(type=BLOCKER, trigger=PASSIVE)
    """

    type: EffectType
    trigger: EffectTrigger = EffectTrigger.ON_PLAY
    target: str = "opponent_character"  # opponent_character, own_character, opponent_leader, self, any
    condition: EffectCondition | None = None
    count: int = 1  # Number of targets
    amount: int = 0  # Numeric value (draw count, power boost amount, etc.)
    once_per_turn: bool = False
    used_this_turn: bool = False  # Runtime state for once_per_turn tracking

    def can_use(self) -> bool:
        return not self.once_per_turn or not self.used_this_turn

    def mark_used(self) -> None:
        if self.once_per_turn:
            self.used_this_turn = True

    def reset_turn(self) -> None:
        self.used_this_turn = False


@dataclass
class GameCard:
    """A single card instance in the game."""

    instance_id: str  # Unique per copy, e.g. "p1-03"
    card_id: str  # Neo4j card ID, e.g. "OP01-025"
    name: str
    card_type: str  # CHARACTER, EVENT, STAGE, LEADER
    cost: int
    power: int  # Base power
    counter: int  # Counter value (from hand)
    keywords: list[str] = dataclass_field(default_factory=list)
    ability_text: str = ""
    trigger_effect: str = ""
    color: str = ""
    effects: list[EffectTemplate] = dataclass_field(default_factory=list)
    state: CardState = CardState.ACTIVE
    attached_don: int = 0
    power_modifier: int = 0  # Temp buff/debuff this turn

    @property
    def effective_power(self) -> int:
        return self.power + (self.attached_don * 1000) + self.power_modifier

    def reset_turn_modifiers(self) -> None:
        self.power_modifier = 0
        for effect in self.effects:
            effect.reset_turn()

    def has_effect_type(self, effect_type: EffectType) -> bool:
        return any(e.type == effect_type for e in self.effects)

    def get_effects_by_trigger(self, trigger: EffectTrigger) -> list[EffectTemplate]:
        return [e for e in self.effects if e.trigger == trigger and e.can_use()]


@dataclass
class PlayerState:
    """Full state of one player."""

    player_id: str  # "p1" or "p2"
    leader: GameCard
    deck: list[GameCard] = dataclass_field(default_factory=list)
    hand: list[GameCard] = dataclass_field(default_factory=list)
    field: list[GameCard] = dataclass_field(default_factory=list)  # Characters + Stages
    trash: list[GameCard] = dataclass_field(default_factory=list)
    life: list[GameCard] = dataclass_field(default_factory=list)  # Face-down
    don_deck: int = 10  # DON!! remaining in DON deck
    don_field: int = 0  # Unattached DON!! available
    don_rested: int = 0  # DON!! spent on card costs this turn (returns at refresh)

    @property
    def characters(self) -> list[GameCard]:
        return [c for c in self.field if c.card_type == "CHARACTER"]

    @property
    def stages(self) -> list[GameCard]:
        return [c for c in self.field if c.card_type == "STAGE"]

    def find_card_on_field(self, instance_id: str) -> GameCard | None:
        for card in self.field:
            if card.instance_id == instance_id:
                return card
        return None

    def find_card_in_hand(self, instance_id: str) -> GameCard | None:
        for card in self.hand:
            if card.instance_id == instance_id:
                return card
        return None


@dataclass
class GameAction:
    """An action a player can take."""

    action_type: ActionType
    source_id: str = ""  # instance_id of acting card
    target_id: str = ""  # instance_id of target card
    card_ids: list[str] = dataclass_field(
        default_factory=list
    )  # For multi-card actions (counters)
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_type": self.action_type.value,
            "source_id": self.source_id,
            "target_id": self.target_id,
            "card_ids": self.card_ids,
            "description": self.description,
        }


@dataclass
class DecisionRequest:
    """Sent to AI agent to request a decision."""

    decision_type: str  # "main_phase", "blocker", "counter"
    game_summary: str  # Human-readable game state
    legal_actions: list[GameAction] = dataclass_field(default_factory=list)


@dataclass
class GameLogEntry:
    """A single entry in the game log."""

    turn: int
    player: str
    phase: str
    action: str
    details: dict[str, Any] = dataclass_field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "turn": self.turn,
            "player": self.player,
            "phase": self.phase,
            "action": self.action,
            "details": self.details,
        }


@dataclass
class GameState:
    """Full game state."""

    p1: PlayerState
    p2: PlayerState
    turn: int = 0
    phase: Phase = Phase.REFRESH
    active_player_id: str = "p1"
    first_player_id: str = "p1"  # Set by coin flip at game start
    winner: str | None = None
    game_log: list[GameLogEntry] = dataclass_field(default_factory=list)
    max_turns: int = 50  # Safety limit

    @property
    def active_player(self) -> PlayerState:
        return self.p1 if self.active_player_id == "p1" else self.p2

    @property
    def defending_player(self) -> PlayerState:
        return self.p2 if self.active_player_id == "p1" else self.p1

    def log(self, player: str, phase: str, action: str, **details: Any) -> None:
        self.game_log.append(
            GameLogEntry(
                turn=self.turn,
                player=player,
                phase=phase,
                action=action,
                details=details,
            )
        )

    def is_game_over(self) -> bool:
        return self.winner is not None or self.turn > self.max_turns


@dataclass
class GameResult:
    """Result of a completed game."""

    winner: str  # "p1", "p2", or "draw"
    turns: int
    p1_life_remaining: int
    p2_life_remaining: int
    first_player: str = "p1"  # Who went first this game
    p1_cards_played: dict[str, int] = dataclass_field(
        default_factory=dict
    )  # card_id -> times played
    p2_cards_played: dict[str, int] = dataclass_field(default_factory=dict)
    game_log: list[dict[str, Any]] = dataclass_field(default_factory=list)


@dataclass
class SimulationResult:
    """Aggregated results from multiple games."""

    num_games: int
    p1_wins: int
    p2_wins: int
    draws: int
    avg_turns: float
    p1_leader: str
    p2_leader: str
    card_stats: dict[str, CardStat] = dataclass_field(default_factory=dict)
    sample_games: list[GameResult] = dataclass_field(default_factory=list)
    weakness_analysis: str = ""

    @property
    def p1_win_rate(self) -> float:
        return self.p1_wins / max(self.num_games, 1)

    @property
    def p2_win_rate(self) -> float:
        return self.p2_wins / max(self.num_games, 1)


@dataclass
class CardStat:
    """Performance statistics for a single card across games."""

    card_id: str
    card_name: str
    times_drawn: int = 0
    times_played: int = 0
    times_in_winning_game: int = 0
    total_games: int = 0
    damage_contributed: int = 0  # Successful attacks
    times_koed: int = 0

    @property
    def play_rate(self) -> float:
        return self.times_played / max(self.times_drawn, 1)

    @property
    def win_correlation(self) -> float:
        return self.times_in_winning_game / max(self.times_played, 1)
