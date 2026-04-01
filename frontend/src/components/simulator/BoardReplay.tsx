import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogEntry {
  turn: number;
  player: string;
  phase: string;
  action: string;
  details: Record<string, unknown>;
}

interface FieldCard {
  name: string;
  power: number;
  state: 'active' | 'rested';
  don: number;
}

interface BoardState {
  turn: number;
  activePlayer: string;
  p1Hand: string[];
  p2Hand: string[];
  p1Life: number;
  p2Life: number;
  p1Field: FieldCard[];
  p2Field: FieldCard[];
  p1DonAvailable: number;
  p2DonAvailable: number;
  p1DonRested: number;
  p2DonRested: number;
  p1DonAttached: number;
  p2DonAttached: number;
  p1DonDeck: number;
  p2DonDeck: number;
  p1DeckCount: number;
  p2DeckCount: number;
  actionText: string;
  actionType: string;
  actionPlayer: string;
  actionDetails: Record<string, unknown>;
  /** Names of cards involved in the current action (for highlighting) */
  highlightCards: string[];
  winner: string | null;
}

interface BoardReplayProps {
  gameLog: Array<{
    turn: number;
    player: string;
    phase: string;
    action: string;
    details: Record<string, unknown>;
  }>;
  p1Leader: string;
  p2Leader: string;
  winner: string;
}

// ---------------------------------------------------------------------------
// Action formatting
// ---------------------------------------------------------------------------

interface ActionDisplay {
  icon: string;
  text: string;
  colorClass: string;
  glowing?: boolean;
}

function formatAction(entry: LogEntry, p1Leader: string, p2Leader: string): ActionDisplay {
  const d = entry.details;
  const playerName = entry.player === 'p1' ? p1Leader : p2Leader;
  const playerLabel = entry.player === 'p1' ? 'P1' : 'P2';

  switch (entry.action) {
    case 'play_card':
    case 'play_event':
      return {
        icon: '\u25B6',
        text: `${playerLabel} plays ${d.card_name ?? '?'} (cost ${d.cost ?? '?'})`,
        colorClass: 'text-green-400',
      };
    case 'attack_declared':
      return {
        icon: '\u2694\uFE0F',
        text: `${d.attacker ?? '?'} attacks ${d.target ?? '?'} (${d.attacker_power ?? '?'} vs ${d.target_power ?? '?'})`,
        colorClass: 'text-orange-400',
      };
    case 'character_koed':
      return {
        icon: '\u2620',
        text: `${d.card_name ?? '?'} was KO'd`,
        colorClass: 'text-red-500',
      };
    case 'life_lost':
      return {
        icon: '\u2764',
        text: `${playerLabel} lost 1 life (${d.remaining ?? 0} remaining)`,
        colorClass: 'text-red-400',
      };
    case 'counter_played':
      return {
        icon: '\uD83D\uDEE1',
        text: `Counter: ${d.card_name ?? '?'} (+${d.counter_value ?? 0})`,
        colorClass: 'text-cyan-400',
      };
    case 'blocker_used':
      return {
        icon: '\uD83D\uDEE1',
        text: `Blocker: ${d.blocker ?? '?'} intercepts`,
        colorClass: 'text-blue-400',
      };
    case 'attach_don':
      return {
        icon: '\u26A1',
        text: `DON \u2192 ${d.card_name ?? '?'} (now ${d.new_power ?? '?'})`,
        colorClass: 'text-amber-400',
      };
    case 'draw_card':
      return {
        icon: '\uD83D\uDCE5',
        text: `${playerLabel} draws ${d.card_name ?? 'a card'}`,
        colorClass: 'text-blue-400',
      };
    case 'add_don':
      return {
        icon: '+',
        text: `+${d.amount ?? '?'} DON (total: ${d.total ?? '?'})`,
        colorClass: 'text-amber-400',
      };
    case 'final_blow':
      return {
        icon: '\uD83D\uDCA5',
        text: `FINAL BLOW! ${playerName} wins!`,
        colorClass: 'text-yellow-300',
        glowing: true,
      };
    case 'pass':
      return {
        icon: '\u2014',
        text: `${playerLabel} passes`,
        colorClass: 'text-gray-500',
      };
    case 'mulligan':
      return {
        icon: '\uD83D\uDD04',
        text: `${playerLabel} mulligans hand`,
        colorClass: 'text-purple-400',
      };
    case 'attack_failed':
      return {
        icon: '\u2717',
        text: `Attack failed (${d.attack_power ?? '?'} vs ${d.defense_power ?? '?'})`,
        colorClass: 'text-red-400',
      };
    case 'game_initialized':
      return {
        icon: '\uD83C\uDFAE',
        text: `Game starts! ${d.first_player === 'p1' ? p1Leader : p2Leader} goes first`,
        colorClass: 'text-gray-300',
      };
    case 'deck_out':
      return {
        icon: '!',
        text: `${playerLabel} decked out!`,
        colorClass: 'text-red-400',
      };
    case 'start':
      return {
        icon: '\u25B6',
        text: `Turn ${entry.details.turn ?? entry.turn} begins`,
        colorClass: 'text-gray-400',
      };
    default:
      return {
        icon: '\u00B7',
        text: `${playerLabel}: ${entry.action}`,
        colorClass: 'text-gray-400',
      };
  }
}

function getHighlightCards(entry: LogEntry): string[] {
  const d = entry.details;
  const cards: string[] = [];
  if (d.card_name && typeof d.card_name === 'string') cards.push(d.card_name);
  if (d.attacker && typeof d.attacker === 'string') cards.push(d.attacker);
  if (d.blocker && typeof d.blocker === 'string') cards.push(d.blocker);
  if (d.target && typeof d.target === 'string' && d.target !== 'Leader') cards.push(d.target);
  return cards;
}

// ---------------------------------------------------------------------------
// Step reconstruction
// ---------------------------------------------------------------------------

function buildSteps(gameLog: LogEntry[], p1Leader: string, p2Leader: string): BoardState[] {
  if (gameLog.length === 0) return [];

  const steps: BoardState[] = [];

  const defaultState = (): BoardState => ({
    turn: 0,
    activePlayer: 'p1',
    p1Hand: [],
    p2Hand: [],
    p1Life: 5,
    p2Life: 5,
    p1Field: [],
    p2Field: [],
    p1DonAvailable: 0,
    p2DonAvailable: 0,
    p1DonRested: 0,
    p2DonRested: 0,
    p1DonAttached: 0,
    p2DonAttached: 0,
    p1DonDeck: 10,
    p2DonDeck: 10,
    p1DeckCount: 40,
    p2DeckCount: 40,
    actionText: '',
    actionType: '',
    actionPlayer: '',
    actionDetails: {},
    highlightCards: [],
    winner: null,
  });

  const cloneState = (s: BoardState): BoardState => ({
    ...s,
    p1Hand: [...s.p1Hand],
    p2Hand: [...s.p2Hand],
    p1Field: s.p1Field.map((c) => ({ ...c })),
    p2Field: s.p2Field.map((c) => ({ ...c })),
    actionDetails: { ...s.actionDetails },
    highlightCards: [],
  });

  for (const entry of gameLog) {
    const display = formatAction(entry, p1Leader, p2Leader);
    const highlights = getHighlightCards(entry);

    // Turn start with full snapshot
    if (entry.action === 'start' && entry.phase === 'turn') {
      const d = entry.details;
      const state: BoardState = {
        turn: (d.turn as number) ?? entry.turn,
        activePlayer: entry.player || 'p1',
        p1Hand: (d.p1_hand as string[]) ?? [],
        p2Hand: (d.p2_hand as string[]) ?? [],
        p1Life: (d.p1_life as number) ?? 5,
        p2Life: (d.p2_life as number) ?? 5,
        p1Field: (d.p1_field_details as FieldCard[]) ?? [],
        p2Field: (d.p2_field_details as FieldCard[]) ?? [],
        p1DonAvailable: (d.p1_don as number) ?? 0,
        p2DonAvailable: (d.p2_don as number) ?? 0,
        p1DonRested: (d.p1_don_rested as number) ?? 0,
        p2DonRested: (d.p2_don_rested as number) ?? 0,
        p1DonAttached: (d.p1_don_attached as number) ?? 0,
        p2DonAttached: (d.p2_don_attached as number) ?? 0,
        p1DonDeck: (d.p1_don_deck as number) ?? 10,
        p2DonDeck: (d.p2_don_deck as number) ?? 10,
        p1DeckCount: steps.length > 0 ? steps[steps.length - 1].p1DeckCount : 40,
        p2DeckCount: steps.length > 0 ? steps[steps.length - 1].p2DeckCount : 40,
        actionText: display.text,
        actionType: entry.action,
        actionPlayer: entry.player,
        actionDetails: entry.details,
        highlightCards: highlights,
        winner: null,
      };
      steps.push(state);
      continue;
    }

    // Clone previous state and apply delta
    const prev = steps.length > 0 ? steps[steps.length - 1] : defaultState();
    const state = cloneState(prev);
    state.turn = entry.turn;
    state.actionText = display.text;
    state.actionType = entry.action;
    state.actionPlayer = entry.player;
    state.actionDetails = entry.details;
    state.highlightCards = highlights;

    const d = entry.details;
    const isP1 = entry.player === 'p1';

    switch (entry.action) {
      case 'play_card':
      case 'play_event': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          const hand = isP1 ? state.p1Hand : state.p2Hand;
          const idx = hand.indexOf(cardName);
          if (idx !== -1) hand.splice(idx, 1);
          // Only add to field for characters, not events
          if (entry.action === 'play_card') {
            const field = isP1 ? state.p1Field : state.p2Field;
            field.push({
              name: cardName,
              power: (d.power as number) ?? 0,
              state: 'rested',
              don: 0,
            });
          }
        }
        break;
      }
      case 'attach_don': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          const field = isP1 ? state.p1Field : state.p2Field;
          const card = field.find((c) => c.name === cardName);
          if (card) {
            card.don += 1;
            card.power = (d.new_power as number) ?? card.power;
          }
          if (isP1) {
            state.p1DonAvailable = Math.max(0, state.p1DonAvailable - 1);
            state.p1DonAttached += 1;
          } else {
            state.p2DonAvailable = Math.max(0, state.p2DonAvailable - 1);
            state.p2DonAttached += 1;
          }
        }
        break;
      }
      case 'attack_declared': {
        const attackerName = d.attacker as string | undefined;
        if (attackerName) {
          const field = isP1 ? state.p1Field : state.p2Field;
          const card = field.find((c) => c.name === attackerName);
          if (card) card.state = 'rested';
        }
        break;
      }
      case 'character_koed': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          // Could be on either side
          state.p1Field = state.p1Field.filter((c) => c.name !== cardName);
          state.p2Field = state.p2Field.filter((c) => c.name !== cardName);
        }
        break;
      }
      case 'life_lost': {
        if (isP1) {
          state.p1Life = (d.remaining as number) ?? Math.max(0, state.p1Life - 1);
        } else {
          state.p2Life = (d.remaining as number) ?? Math.max(0, state.p2Life - 1);
        }
        break;
      }
      case 'counter_played': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          // Counter can be played by the defending player
          const hand = isP1 ? state.p1Hand : state.p2Hand;
          const idx = hand.indexOf(cardName);
          if (idx !== -1) hand.splice(idx, 1);
        }
        break;
      }
      case 'draw_card': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          const hand = isP1 ? state.p1Hand : state.p2Hand;
          hand.push(cardName);
        }
        if (isP1) state.p1DeckCount = Math.max(0, state.p1DeckCount - 1);
        else state.p2DeckCount = Math.max(0, state.p2DeckCount - 1);
        break;
      }
      case 'add_don': {
        if (isP1) {
          state.p1DonAvailable = (d.total as number) ?? state.p1DonAvailable + ((d.amount as number) ?? 0);
          state.p1DonDeck = Math.max(0, state.p1DonDeck - ((d.amount as number) ?? 0));
        } else {
          state.p2DonAvailable = (d.total as number) ?? state.p2DonAvailable + ((d.amount as number) ?? 0);
          state.p2DonDeck = Math.max(0, state.p2DonDeck - ((d.amount as number) ?? 0));
        }
        break;
      }
      case 'final_blow': {
        state.winner = isP1 ? 'p1' : 'p2';
        break;
      }
      case 'blocker_used': {
        const blockerName = d.blocker as string | undefined;
        if (blockerName) {
          // Blocker is on the defending side
          const defField = isP1 ? state.p1Field : state.p2Field;
          const card = defField.find((c) => c.name === blockerName);
          if (card) card.state = 'rested';
        }
        break;
      }
      // pass, mulligan, game_initialized, deck_out, etc. — no board change
      default:
        break;
    }

    steps.push(state);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldCardSlot({
  card,
  color,
  highlighted,
}: {
  card: FieldCard;
  color: 'blue' | 'red';
  highlighted: boolean;
}) {
  const isRested = card.state === 'rested';
  const borderColor = color === 'blue' ? 'border-blue-500' : 'border-red-500';
  const highlightRing = highlighted ? 'ring-2 ring-yellow-400' : '';
  const truncatedName = card.name.length > 8 ? card.name.slice(0, 8) + '\u2026' : card.name;

  return (
    <div
      className={`
        relative w-[76px] h-[96px] rounded-lg border-2 ${borderColor} ${highlightRing}
        bg-gray-800 flex flex-col items-center justify-between p-1.5
        transition-all duration-200 select-none shrink-0
        ${isRested ? 'rotate-[20deg] opacity-70 scale-95' : ''}
      `}
      title={`${card.name} (${card.power} power${card.don > 0 ? `, ${card.don} DON` : ''}${isRested ? ', rested' : ''})`}
    >
      {/* Card name */}
      <span className="text-[10px] text-gray-300 leading-tight text-center w-full truncate">
        {truncatedName}
      </span>

      {/* Power */}
      <span className={`text-lg font-bold ${card.don > 0 ? 'text-green-400' : 'text-white'}`}>
        {card.power >= 1000 ? `${(card.power / 1000).toFixed(0)}k` : card.power}
      </span>

      {/* DON indicator */}
      {card.don > 0 && (
        <div className="flex items-center gap-0.5">
          <span className="text-amber-400 text-[9px]">{'\u26A1'}</span>
          <span className="text-amber-300 text-[10px] font-medium">{card.don}</span>
        </div>
      )}
      {card.don === 0 && <div className="h-3" />}

      {/* Rested overlay */}
      {isRested && (
        <div className="absolute inset-0 bg-gray-900/30 rounded-lg pointer-events-none" />
      )}
    </div>
  );
}

function PlayerInfoBar({
  label,
  leader,
  life,
  donAvailable,
  donRested,
  donAttached,
  donDeck,
  deckCount,
  handCount,
  color,
  isTop,
}: {
  label: string;
  leader: string;
  life: number;
  donAvailable: number;
  donRested: number;
  donAttached: number;
  donDeck: number;
  deckCount: number;
  handCount: number;
  color: 'blue' | 'red';
  isTop: boolean;
}) {
  const textColor = color === 'blue' ? 'text-blue-400' : 'text-red-400';
  const bgColor = color === 'blue' ? 'bg-blue-950/30' : 'bg-red-950/30';
  const borderColor = color === 'blue' ? 'border-blue-800/30' : 'border-red-800/30';

  return (
    <div className={`${bgColor} border ${borderColor} rounded-lg px-4 py-2 ${isTop ? 'mb-2' : 'mt-2'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
          <span className="text-xs text-gray-400">{leader}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-red-400">
            {'\u2764'} {life}
          </span>
          <span className="text-amber-400" title={`${donAvailable} available, ${donRested} rested, ${donAttached} attached`}>
            {'\u26A1'} {donAvailable} DON
            {donRested > 0 && <span className="text-amber-500/70"> ({donRested} rested)</span>}
            {donAttached > 0 && <span className="text-orange-400/70"> ({donAttached} att.)</span>}
          </span>
          <span className="text-gray-500" title="DON deck remaining">
            DON deck: {donDeck}
          </span>
          <span className="text-gray-500" title="Main deck remaining">
            Deck: {deckCount}
          </span>
          {!isTop && (
            <span className="text-blue-300" title="Cards in hand">
              Hand: {handCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionBar({
  entry,
  p1Leader,
  p2Leader,
}: {
  entry: { actionType: string; actionText: string; actionPlayer: string; actionDetails: Record<string, unknown> };
  p1Leader: string;
  p2Leader: string;
}) {
  // Determine color based on action type
  let bgClass = 'bg-gray-800/80 border-gray-600/50';
  let textClass = 'text-gray-300';
  let glow = false;

  const logEntry: LogEntry = {
    turn: 0,
    player: entry.actionPlayer,
    phase: '',
    action: entry.actionType,
    details: entry.actionDetails,
  };
  const display = formatAction(logEntry, p1Leader, p2Leader);
  textClass = display.colorClass;
  glow = display.glowing ?? false;

  switch (entry.actionType) {
    case 'play_card':
    case 'play_event':
      bgClass = 'bg-green-950/40 border-green-700/40';
      break;
    case 'attack_declared':
      bgClass = 'bg-orange-950/40 border-orange-700/40';
      break;
    case 'character_koed':
      bgClass = 'bg-red-950/40 border-red-700/40';
      break;
    case 'life_lost':
      bgClass = 'bg-red-950/30 border-red-600/40';
      break;
    case 'counter_played':
      bgClass = 'bg-cyan-950/30 border-cyan-700/40';
      break;
    case 'blocker_used':
      bgClass = 'bg-blue-950/30 border-blue-700/40';
      break;
    case 'attach_don':
    case 'add_don':
      bgClass = 'bg-amber-950/30 border-amber-700/40';
      break;
    case 'final_blow':
      bgClass = 'bg-yellow-950/40 border-yellow-500/50';
      break;
    case 'attack_failed':
      bgClass = 'bg-red-950/30 border-red-600/30';
      break;
    case 'draw_card':
      bgClass = 'bg-blue-950/20 border-blue-700/30';
      break;
    case 'mulligan':
      bgClass = 'bg-purple-950/30 border-purple-700/40';
      break;
  }

  return (
    <div
      className={`
        mx-auto max-w-lg rounded-lg border ${bgClass} px-4 py-2.5 text-center
        transition-all duration-300
        ${glow ? 'shadow-[0_0_20px_rgba(234,179,8,0.3)]' : ''}
      `}
    >
      <span className={`text-sm font-medium ${textClass}`}>
        {display.icon} {entry.actionText}
      </span>
    </div>
  );
}

function HandDisplay({ cards }: { cards: string[] }) {
  if (cards.length === 0) {
    return <span className="text-xs text-gray-600 italic">Empty hand</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {cards.map((card, i) => (
        <span
          key={`${card}-${i}`}
          className="text-[11px] bg-gray-800 border border-gray-700/60 rounded px-2 py-0.5 text-gray-300"
        >
          {card}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function BoardReplay({ gameLog, p1Leader, p2Leader, winner }: BoardReplayProps) {
  const steps = useMemo(
    () => buildSteps(gameLog as LogEntry[], p1Leader, p2Leader),
    [gameLog, p1Leader, p2Leader],
  );

  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0); // seconds per step
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSteps = steps.length;
  const state = totalSteps > 0 ? steps[currentStep] : null;

  // Auto-play logic
  useEffect(() => {
    if (isPlaying && totalSteps > 0) {
      intervalRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= totalSteps - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, speed * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, totalSteps]);

  // Keyboard controls
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentStep((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentStep((prev) => Math.min(totalSteps - 1, prev + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    },
    [totalSteps],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (totalSteps === 0 || !state) {
    return (
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-8 text-center text-sm text-gray-500">
        No game log data available for replay.
      </div>
    );
  }

  const winnerLabel =
    winner === 'p1' ? p1Leader : winner === 'p2' ? p2Leader : 'Draw';

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 overflow-hidden">
      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/60 border-b border-gray-700/40">
        {/* Step counter */}
        <span className="text-xs text-gray-400 font-mono shrink-0">
          Step {currentStep + 1}/{totalSteps}
        </span>

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setCurrentStep(0); setIsPlaying(false); }}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Go to start"
          >
            |&lt;
          </button>
          <button
            onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Previous step (Left arrow)"
          >
            &lt;
          </button>
          <button
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              isPlaying
                ? 'bg-yellow-600/80 text-white hover:bg-yellow-500/80'
                : 'bg-blue-600/80 text-white hover:bg-blue-500/80'
            }`}
            title="Auto-play (Space)"
          >
            {isPlaying ? '\u23F8 Pause' : '\u25B6 Auto'}
          </button>
          <button
            onClick={() => setCurrentStep((prev) => Math.min(totalSteps - 1, prev + 1))}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Next step (Right arrow)"
          >
            &gt;
          </button>
          <button
            onClick={() => { setCurrentStep(totalSteps - 1); setIsPlaying(false); }}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors"
            title="Go to end"
          >
            &gt;|
          </button>
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-gray-500">Speed:</span>
          <input
            type="range"
            min={0.3}
            max={3.0}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-20 h-1 accent-blue-500"
            title={`${speed.toFixed(1)}s per step`}
          />
          <span className="text-[10px] text-gray-500 font-mono w-8">{speed.toFixed(1)}s</span>
        </div>

        {/* Turn indicator */}
        <span className="text-xs text-gray-300 font-medium shrink-0">
          Turn {state.turn}
          {state.activePlayer && (
            <span className={state.activePlayer === 'p1' ? 'text-blue-400 ml-1' : 'text-red-400 ml-1'}>
              {state.activePlayer === 'p1' ? p1Leader : p2Leader}
            </span>
          )}
        </span>
      </div>

      {/* Progress scrubber */}
      <div className="px-4 py-1 bg-gray-800/30">
        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={currentStep}
          onChange={(e) => {
            setCurrentStep(parseInt(e.target.value));
            setIsPlaying(false);
          }}
          className="w-full h-1.5 accent-blue-500 cursor-pointer"
        />
      </div>

      {/* Board */}
      <div className="p-4 space-y-3">
        {/* P2 (opponent) — top */}
        <PlayerInfoBar
          label="P2"
          leader={p2Leader}
          life={state.p2Life}
          donAvailable={state.p2DonAvailable}
          donRested={state.p2DonRested}
          donAttached={state.p2DonAttached}
          donDeck={state.p2DonDeck}
          deckCount={state.p2DeckCount}
          handCount={state.p2Hand.length}
          color="red"
          isTop={true}
        />

        {/* P2 field */}
        <div className="flex items-center justify-center gap-2 min-h-[110px] flex-wrap py-2">
          {state.p2Field.length > 0 ? (
            state.p2Field.map((card, i) => (
              <FieldCardSlot
                key={`p2-${card.name}-${i}`}
                card={card}
                color="red"
                highlighted={state.highlightCards.includes(card.name)}
              />
            ))
          ) : (
            <span className="text-xs text-gray-600 italic">No characters on field</span>
          )}
        </div>

        {/* Action bar — center */}
        {state.actionText && (
          <ActionBar entry={state} p1Leader={p1Leader} p2Leader={p2Leader} />
        )}

        {/* P1 field */}
        <div className="flex items-center justify-center gap-2 min-h-[110px] flex-wrap py-2">
          {state.p1Field.length > 0 ? (
            state.p1Field.map((card, i) => (
              <FieldCardSlot
                key={`p1-${card.name}-${i}`}
                card={card}
                color="blue"
                highlighted={state.highlightCards.includes(card.name)}
              />
            ))
          ) : (
            <span className="text-xs text-gray-600 italic">No characters on field</span>
          )}
        </div>

        {/* P1 (player) — bottom */}
        <PlayerInfoBar
          label="P1"
          leader={p1Leader}
          life={state.p1Life}
          donAvailable={state.p1DonAvailable}
          donRested={state.p1DonRested}
          donAttached={state.p1DonAttached}
          donDeck={state.p1DonDeck}
          deckCount={state.p1DeckCount}
          handCount={state.p1Hand.length}
          color="blue"
          isTop={false}
        />

        {/* P1 hand */}
        <div className="mt-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">Hand</span>
          <HandDisplay cards={state.p1Hand} />
        </div>
      </div>

      {/* Winner banner */}
      {state.winner && (
        <div className="px-4 py-3 bg-yellow-950/30 border-t border-yellow-700/40 text-center">
          <span className="text-sm font-bold text-yellow-300">
            {'\uD83C\uDFC6'} {winnerLabel} wins!
          </span>
        </div>
      )}
    </div>
  );
}
