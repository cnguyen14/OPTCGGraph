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

interface HandCard {
  name: string;
  card_id: string;
  image: string;
  cost: number;
  power: number;
  counter: number;
  card_type: string;
}

interface FieldCard {
  name: string;
  card_id: string;
  image: string;
  power: number;
  state: 'active' | 'rested';
  don: number;
  card_type: string;
  cost: number;
}

interface LeaderInfo {
  name: string;
  card_id: string;
  image: string;
  power: number;
  don: number;
  state: 'active' | 'rested';
}

interface PlayerBoardState {
  leader: LeaderInfo;
  life: number;
  hand: HandCard[];
  field: FieldCard[];
  donAvailable: number;
  donRested: number;
  donAttached: number;
  donDeck: number;
  deckRemaining: number;
  trash: number;
}

interface BoardState {
  turn: number;
  activePlayer: string;
  p1: PlayerBoardState;
  p2: PlayerBoardState;
  action: string;
  actionType: string;
  actionPlayer: string;
  actionDetails: Record<string, unknown>;
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
  bgClass: string;
  glowing?: boolean;
}

const ACTION_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  play_card: { icon: '\u25B6', color: 'text-green-400', bg: 'bg-green-950/40 border-green-700/40' },
  play_event: { icon: '\u2726', color: 'text-purple-400', bg: 'bg-purple-950/40 border-purple-700/40' },
  attack_declared: { icon: '\u2694\uFE0F', color: 'text-orange-400', bg: 'bg-orange-950/40 border-orange-700/40' },
  attack_failed: { icon: '\u2717', color: 'text-red-400', bg: 'bg-red-950/30 border-red-600/30' },
  character_koed: { icon: '\u2620', color: 'text-red-500', bg: 'bg-red-950/40 border-red-700/40' },
  life_lost: { icon: '\u2764', color: 'text-red-400', bg: 'bg-red-950/30 border-red-600/40' },
  counter_played: { icon: '\uD83D\uDEE1', color: 'text-cyan-400', bg: 'bg-cyan-950/30 border-cyan-700/40' },
  blocker_used: { icon: '\uD83D\uDEE1', color: 'text-blue-400', bg: 'bg-blue-950/30 border-blue-700/40' },
  attach_don: { icon: '\u26A1', color: 'text-amber-400', bg: 'bg-amber-950/30 border-amber-700/40' },
  draw_card: { icon: '\uD83D\uDCE5', color: 'text-blue-300', bg: 'bg-blue-950/20 border-blue-700/30' },
  add_don: { icon: '+', color: 'text-amber-300', bg: 'bg-amber-950/30 border-amber-700/40' },
  final_blow: { icon: '\uD83D\uDCA5', color: 'text-yellow-300', bg: 'bg-yellow-950/40 border-yellow-500/50' },
  pass: { icon: '\u2014', color: 'text-gray-500', bg: 'bg-gray-800/80 border-gray-600/50' },
  mulligan: { icon: '\uD83D\uDD04', color: 'text-purple-400', bg: 'bg-purple-950/30 border-purple-700/40' },
  start: { icon: '\u25CF', color: 'text-gray-400', bg: 'bg-gray-800/80 border-gray-600/50' },
  game_initialized: { icon: '\u25CF', color: 'text-gray-400', bg: 'bg-gray-800/80 border-gray-600/50' },
  deck_out: { icon: '\uD83D\uDCE6', color: 'text-red-400', bg: 'bg-red-950/30 border-red-600/30' },
};

function formatAction(entry: LogEntry, p1Leader: string, p2Leader: string): ActionDisplay {
  const d = entry.details;
  const playerLabel = entry.player === 'p1' ? 'P1' : 'P2';
  const playerName = entry.player === 'p1' ? p1Leader : p2Leader;
  const cfg = ACTION_CONFIG[entry.action] ?? { icon: '\u00B7', color: 'text-gray-400', bg: 'bg-gray-800/80 border-gray-600/50' };

  let text = '';
  let glowing = false;

  switch (entry.action) {
    case 'play_card':
    case 'play_event':
      text = `${playerLabel} plays ${d.card_name ?? '?'} (cost ${d.cost ?? '?'})`;
      break;
    case 'attack_declared':
      text = `${d.attacker ?? '?'} attacks ${d.target ?? '?'} (${d.attacker_power ?? '?'} vs ${d.target_power ?? '?'})`;
      break;
    case 'character_koed':
      text = `${d.card_name ?? '?'} was KO'd`;
      break;
    case 'life_lost':
      text = `${playerLabel} lost 1 life (${d.remaining ?? 0} remaining)`;
      break;
    case 'counter_played':
      text = `Counter: ${d.card_name ?? '?'} (+${d.counter_value ?? 0})`;
      break;
    case 'blocker_used':
      text = `Blocker: ${d.blocker ?? '?'} intercepts`;
      break;
    case 'attach_don':
      text = `DON \u2192 ${d.card_name ?? '?'} (now ${d.new_power ?? '?'})`;
      break;
    case 'draw_card':
      text = `${playerLabel} draws ${d.card_name ?? 'a card'}`;
      break;
    case 'add_don':
      text = `+${d.amount ?? '?'} DON (total: ${d.total ?? '?'})`;
      break;
    case 'final_blow':
      text = `FINAL BLOW! ${playerName} wins!`;
      glowing = true;
      break;
    case 'pass':
      text = `${playerLabel} passes`;
      break;
    case 'mulligan':
      text = `${playerLabel} mulligans hand`;
      break;
    case 'attack_failed':
      text = `Attack failed (${d.attack_power ?? '?'} vs ${d.defense_power ?? '?'})`;
      break;
    case 'game_initialized':
      text = `Game starts! ${d.first_player === 'p1' ? p1Leader : p2Leader} goes first`;
      break;
    case 'deck_out':
      text = `${playerLabel} decked out!`;
      break;
    case 'start':
      text = `Turn ${d.turn ?? entry.turn} begins`;
      break;
    default:
      text = `${playerLabel}: ${entry.action}`;
      break;
  }

  return { icon: cfg.icon, text, colorClass: cfg.color, bgClass: cfg.bg, glowing };
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
// Step reconstruction — updated for new rich data format
// ---------------------------------------------------------------------------

function defaultLeader(name: string): LeaderInfo {
  return { name, card_id: '', image: '', power: 5000, don: 0, state: 'active' };
}

function defaultPlayerState(leaderName: string): PlayerBoardState {
  return {
    leader: defaultLeader(leaderName),
    life: 5,
    hand: [],
    field: [],
    donAvailable: 0,
    donRested: 0,
    donAttached: 0,
    donDeck: 10,
    deckRemaining: 40,
    trash: 0,
  };
}

function clonePlayer(p: PlayerBoardState): PlayerBoardState {
  return {
    leader: { ...p.leader },
    life: p.life,
    hand: p.hand.map((c) => ({ ...c })),
    field: p.field.map((c) => ({ ...c })),
    donAvailable: p.donAvailable,
    donRested: p.donRested,
    donAttached: p.donAttached,
    donDeck: p.donDeck,
    deckRemaining: p.deckRemaining,
    trash: p.trash,
  };
}

function cloneState(s: BoardState): BoardState {
  return {
    ...s,
    p1: clonePlayer(s.p1),
    p2: clonePlayer(s.p2),
    actionDetails: { ...s.actionDetails },
    highlightCards: [],
  };
}

function parseHandCards(raw: unknown): HandCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === 'string') {
      return { name: item, card_id: '', image: '', cost: 0, power: 0, counter: 0, card_type: '' };
    }
    const obj = item as Record<string, unknown>;
    return {
      name: (obj.name as string) ?? '',
      card_id: (obj.card_id as string) ?? '',
      image: (obj.image as string) ?? '',
      cost: (obj.cost as number) ?? 0,
      power: (obj.power as number) ?? 0,
      counter: (obj.counter as number) ?? 0,
      card_type: (obj.card_type as string) ?? '',
    };
  });
}

function parseFieldCards(raw: unknown): FieldCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const obj = item as Record<string, unknown>;
    return {
      name: (obj.name as string) ?? '',
      card_id: (obj.card_id as string) ?? '',
      image: (obj.image as string) ?? '',
      power: (obj.power as number) ?? 0,
      state: ((obj.state as string) === 'rested' ? 'rested' : 'active') as 'active' | 'rested',
      don: (obj.don as number) ?? 0,
      card_type: (obj.card_type as string) ?? '',
      cost: (obj.cost as number) ?? 0,
    };
  });
}

function parseLeaderInfo(raw: unknown, fallbackName: string): LeaderInfo {
  if (!raw || typeof raw !== 'object') return defaultLeader(fallbackName);
  const obj = raw as Record<string, unknown>;
  return {
    name: (obj.name as string) ?? fallbackName,
    card_id: (obj.card_id as string) ?? '',
    image: (obj.image as string) ?? '',
    power: (obj.power as number) ?? 5000,
    don: (obj.don as number) ?? 0,
    state: ((obj.state as string) === 'rested' ? 'rested' : 'active') as 'active' | 'rested',
  };
}

function buildSteps(gameLog: LogEntry[], p1Leader: string, p2Leader: string): BoardState[] {
  if (gameLog.length === 0) return [];

  const steps: BoardState[] = [];

  const defaultState = (): BoardState => ({
    turn: 0,
    activePlayer: 'p1',
    p1: defaultPlayerState(p1Leader),
    p2: defaultPlayerState(p2Leader),
    action: '',
    actionType: '',
    actionPlayer: '',
    actionDetails: {},
    highlightCards: [],
    winner: null,
  });

  for (const entry of gameLog) {
    const display = formatAction(entry, p1Leader, p2Leader);
    const highlights = getHighlightCards(entry);

    // Turn start with full snapshot
    if (entry.action === 'start' && entry.phase === 'turn') {
      const d = entry.details;
      const prev = steps.length > 0 ? steps[steps.length - 1] : defaultState();

      const state: BoardState = {
        turn: (d.turn as number) ?? entry.turn,
        activePlayer: entry.player || 'p1',
        p1: {
          leader: parseLeaderInfo(d.p1_leader, p1Leader),
          life: (d.p1_life as number) ?? 5,
          hand: parseHandCards(d.p1_hand),
          field: parseFieldCards(d.p1_field_details),
          donAvailable: (d.p1_don as number) ?? 0,
          donRested: (d.p1_don_rested as number) ?? 0,
          donAttached: (d.p1_don_attached as number) ?? 0,
          donDeck: (d.p1_don_deck as number) ?? 10,
          deckRemaining: prev.p1.deckRemaining,
          trash: (d.p1_trash as number) ?? prev.p1.trash,
        },
        p2: {
          leader: parseLeaderInfo(d.p2_leader, p2Leader),
          life: (d.p2_life as number) ?? 5,
          hand: parseHandCards(d.p2_hand),
          field: parseFieldCards(d.p2_field_details),
          donAvailable: (d.p2_don as number) ?? 0,
          donRested: (d.p2_don_rested as number) ?? 0,
          donAttached: (d.p2_don_attached as number) ?? 0,
          donDeck: (d.p2_don_deck as number) ?? 10,
          deckRemaining: prev.p2.deckRemaining,
          trash: (d.p2_trash as number) ?? prev.p2.trash,
        },
        action: display.text,
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
    state.action = display.text;
    state.actionType = entry.action;
    state.actionPlayer = entry.player;
    state.actionDetails = entry.details;
    state.highlightCards = highlights;

    const d = entry.details;
    const isP1 = entry.player === 'p1';
    const player = isP1 ? state.p1 : state.p2;

    switch (entry.action) {
      case 'play_card':
      case 'play_event': {
        const cardName = d.card_name as string | undefined;
        const cardCost = (d.cost as number) ?? 0;
        if (cardName) {
          const idx = player.hand.findIndex((c) => c.name === cardName);
          let removedCard: HandCard | undefined;
          if (idx !== -1) {
            removedCard = player.hand.splice(idx, 1)[0];
          }
          // Pay DON cost: move from available to rested
          if (cardCost > 0) {
            const paid = Math.min(cardCost, player.donAvailable);
            player.donAvailable -= paid;
            player.donRested += paid;
          }
          if (entry.action === 'play_card') {
            const cardImage = (d.card_image as string) ?? removedCard?.image ?? '';
            // Power comes from the hand card data (base power from Neo4j)
            const cardPower = removedCard?.power ?? 0;
            player.field.push({
              name: cardName,
              card_id: removedCard?.card_id ?? '',
              image: cardImage,
              power: cardPower,
              state: 'active',
              don: 0,
              card_type: (d.card_type as string) ?? removedCard?.card_type ?? 'CHARACTER',
              cost: cardCost,
            });
          }
          if (entry.action === 'play_event') {
            player.trash += 1;
          }
        }
        break;
      }
      case 'attach_don': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          // Check if attaching to leader
          if (player.leader.name === cardName) {
            player.leader.don += 1;
            player.leader.power = (d.new_power as number) ?? player.leader.power + 1000;
          } else {
            const card = player.field.find((c) => c.name === cardName);
            if (card) {
              card.don += 1;
              card.power = (d.new_power as number) ?? card.power + 1000;
            }
          }
          player.donAvailable = Math.max(0, player.donAvailable - 1);
          player.donAttached += 1;
        }
        break;
      }
      case 'attack_declared': {
        const attackerName = d.attacker as string | undefined;
        if (attackerName) {
          if (player.leader.name === attackerName) {
            player.leader.state = 'rested';
          } else {
            const card = player.field.find((c) => c.name === attackerName);
            if (card) card.state = 'rested';
          }
        }
        break;
      }
      case 'character_koed': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          const p1Before = state.p1.field.length;
          state.p1.field = state.p1.field.filter((c) => c.name !== cardName);
          if (state.p1.field.length < p1Before) state.p1.trash += 1;

          const p2Before = state.p2.field.length;
          state.p2.field = state.p2.field.filter((c) => c.name !== cardName);
          if (state.p2.field.length < p2Before) state.p2.trash += 1;
        }
        break;
      }
      case 'life_lost': {
        player.life = (d.remaining as number) ?? Math.max(0, player.life - 1);
        // Life card goes to hand (OPTCG rule)
        const lifeName = d.card_name as string | undefined;
        if (lifeName) {
          player.hand.push({
            name: lifeName,
            card_id: (d.card_id as string) ?? '',
            image: (d.card_image as string) ?? '',
            cost: (d.card_cost as number) ?? 0,
            power: (d.card_power as number) ?? 0,
            counter: (d.card_counter as number) ?? 0,
            card_type: (d.card_type as string) ?? '',
          });
        }
        break;
      }
      case 'counter_played': {
        const cardName = d.card_name as string | undefined;
        if (cardName) {
          const idx = player.hand.findIndex((c) => c.name === cardName);
          if (idx !== -1) player.hand.splice(idx, 1);
          player.trash += 1;
        }
        break;
      }
      case 'draw_card': {
        const cardName = d.card_name as string | undefined;
        const cardImage = (d.card_image as string) ?? '';
        if (cardName) {
          player.hand.push({
            name: cardName,
            card_id: '',
            image: cardImage,
            cost: 0,
            power: 0,
            counter: 0,
            card_type: '',
          });
        }
        player.deckRemaining = Math.max(0, player.deckRemaining - 1);
        break;
      }
      case 'add_don': {
        player.donAvailable = (d.total as number) ?? player.donAvailable + ((d.amount as number) ?? 0);
        player.donDeck = Math.max(0, player.donDeck - ((d.amount as number) ?? 0));
        break;
      }
      case 'final_blow': {
        state.winner = isP1 ? 'p1' : 'p2';
        break;
      }
      case 'deck_out': {
        state.winner = isP1 ? (entry.player === 'p1' ? 'p2' : 'p1') : (entry.player === 'p2' ? 'p1' : 'p2');
        break;
      }
      case 'blocker_used': {
        const blockerName = d.blocker as string | undefined;
        if (blockerName) {
          const card = player.field.find((c) => c.name === blockerName);
          if (card) card.state = 'rested';
        }
        break;
      }
      default:
        break;
    }

    steps.push(state);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Card image helper
// ---------------------------------------------------------------------------

function CardImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  if (src) {
    return <img src={src} alt={alt} className={`${className ?? ''} object-cover`} loading="lazy" />;
  }
  return (
    <div className={`${className ?? ''} bg-gray-700 flex items-center justify-center`}>
      <span className="text-[9px] text-gray-400 text-center leading-tight px-0.5">{alt}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — OPTCG Sim style
// ---------------------------------------------------------------------------

function LeaderCard({
  leader,
  isP1,
  highlighted,
}: {
  leader: LeaderInfo;
  isP1: boolean;
  highlighted: boolean;
}) {
  const borderColor = isP1 ? 'border-blue-500' : 'border-red-500';
  const glowColor = isP1 ? 'shadow-blue-500/30' : 'shadow-red-500/30';
  const isRested = leader.state === 'rested';

  // Wrapper reserves space for rotated card (swap w/h when rested)
  return (
    <div className={`shrink-0 ${isRested ? 'w-[126px] h-[90px]' : 'w-[90px] h-[126px]'} flex items-center justify-center transition-all duration-300`}>
      <div
        className={`
          relative w-[90px] h-[126px] rounded-lg overflow-hidden border-2 ${borderColor}
          shadow-lg ${glowColor}
          ${isRested ? 'rotate-90' : ''}
          ${highlighted ? 'ring-2 ring-yellow-400 animate-pulse' : ''}
          transition-all duration-300
        `}
        title={`${leader.name} | Power: ${leader.power}${leader.don > 0 ? ` | DON: ${leader.don}` : ''}${isRested ? ' | Rested' : ''}`}
      >
        <CardImage src={leader.image} alt={leader.name} className="w-full h-full" />
        {/* Power overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/80 px-1.5 py-1 text-center">
          <span className={`text-xs font-bold ${leader.don > 0 ? 'text-green-400' : 'text-white'}`}>
            {leader.power}
          </span>
          {leader.don > 0 && (
            <span className="text-yellow-400 text-[10px] ml-1">{'\u26A1'}{leader.don}</span>
          )}
        </div>
        {/* Leader badge */}
        <div className={`absolute top-0 left-0 right-0 ${isP1 ? 'bg-blue-600/80' : 'bg-red-600/80'} px-1 py-0.5 text-center`}>
          <span className="text-[9px] font-bold text-white uppercase tracking-wider">Leader</span>
        </div>
      </div>
    </div>
  );
}

function FieldCardSlot({
  card,
  isP1,
  highlighted,
}: {
  card: FieldCard;
  isP1: boolean;
  highlighted: boolean;
}) {
  const isRested = card.state === 'rested';
  const borderColor = isP1 ? 'border-blue-500/70' : 'border-red-500/70';

  // Wrapper reserves space for rotated card
  return (
    <div className={`${isRested ? 'w-[100px] h-[72px]' : 'w-[72px] h-[100px]'} flex items-center justify-center shrink-0 transition-all duration-300`}>
      <div
        className={`
          relative w-[72px] h-[100px] rounded-md overflow-hidden border-2 ${borderColor}
          transition-all duration-300
          ${isRested ? 'rotate-90' : ''}
          ${highlighted ? 'ring-2 ring-yellow-400 animate-pulse' : ''}
        `}
        title={`${card.name} | Power: ${card.power}${card.don > 0 ? ` | DON: ${card.don}` : ''}${isRested ? ' | Rested' : ''}`}
      >
        <CardImage src={card.image} alt={card.name} className="w-full h-full" />
      {/* Power overlay at bottom */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5 text-center">
        <span className={`text-xs font-bold ${card.don > 0 ? 'text-green-400' : 'text-white'}`}>
          {card.power}
        </span>
        {card.don > 0 && (
          <span className="text-yellow-400 text-[10px] ml-1">{'\u26A1'}{card.don}</span>
        )}
      </div>
        {/* Rested overlay */}
        {isRested && (
          <div className="absolute inset-0 bg-gray-900/20 pointer-events-none" />
        )}
      </div>
    </div>
  );
}

function HandCardFaceUp({ card, highlighted }: { card: HandCard; highlighted: boolean }) {
  return (
    <div
      className={`
        w-[56px] h-[78px] rounded overflow-hidden border border-gray-600
        hover:scale-110 hover:z-10 transition-transform cursor-pointer shrink-0 relative
        ${highlighted ? 'ring-2 ring-yellow-400 animate-pulse' : ''}
      `}
      title={`${card.name} | Cost: ${card.cost} | Power: ${card.power} | Counter: ${card.counter}`}
    >
      <CardImage src={card.image} alt={card.name} className="w-full h-full" />
    </div>
  );
}

function HandCardFaceDown() {
  return (
    <div className="w-[48px] h-[67px] rounded bg-gradient-to-br from-red-900 to-red-800 border border-red-700 shrink-0">
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-red-600/60" />
      </div>
    </div>
  );
}

function LifePile({ life }: { life: number }) {
  const stackCount = Math.min(life, 3);
  return (
    <div className="relative w-[48px] h-[67px] shrink-0" title={`Life: ${life}`}>
      {Array.from({ length: stackCount }).map((_, i) => (
        <div
          key={i}
          className="absolute bg-gradient-to-br from-red-900 to-red-800 rounded border border-red-700"
          style={{ top: i * 2, left: i * 2, width: 48, height: 67, zIndex: i }}
        />
      ))}
      {life > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span className="text-white font-bold text-lg bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">
            {life}
          </span>
        </div>
      )}
      {life === 0 && (
        <div className="w-[48px] h-[67px] rounded border border-dashed border-red-800/40 flex items-center justify-center">
          <span className="text-[10px] text-red-800">0</span>
        </div>
      )}
    </div>
  );
}

function DonDisplay({ available, rested, donDeck }: { available: number; rested: number; donDeck: number }) {
  const total = available + rested;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: available }).map((_, i) => (
          <div
            key={`a-${i}`}
            className="w-4 h-4 rounded-full bg-yellow-500 border border-yellow-400 shadow-sm shadow-yellow-500/30"
            title="Active DON"
          />
        ))}
        {available > 0 && (
          <span className="text-[10px] text-yellow-400 ml-0.5">{available} active</span>
        )}
      </div>
      {rested > 0 && (
        <div className="flex items-center gap-0.5">
          {Array.from({ length: rested }).map((_, i) => (
            <div
              key={`r-${i}`}
              className="w-4 h-4 rounded-full bg-yellow-900/60 border border-yellow-700/50 rotate-90"
              title="Rested DON"
            />
          ))}
          <span className="text-[10px] text-yellow-700 ml-0.5">{rested} rested</span>
        </div>
      )}
      {total === 0 && <span className="text-[10px] text-gray-600">No DON</span>}
      <span className="text-[10px] text-gray-500 ml-1">DON deck: {donDeck}</span>
    </div>
  );
}

function DeckPile({ count }: { count: number }) {
  return (
    <div
      className="relative w-[48px] h-[67px] bg-gradient-to-br from-blue-900 to-blue-800 rounded border border-blue-700 shrink-0"
      title={`Deck: ${count} cards`}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[9px] text-blue-300 uppercase">Deck</span>
        <span className="text-white font-bold text-sm">{count}</span>
      </div>
    </div>
  );
}

function TrashPile({ count }: { count: number }) {
  return (
    <div
      className="w-[48px] h-[67px] rounded border border-gray-600 bg-gray-800/50 flex flex-col items-center justify-center shrink-0"
      title={`Trash: ${count} cards`}
    >
      <span className="text-[10px] text-gray-500">TRASH</span>
      <span className="text-white font-bold">{count}</span>
    </div>
  );
}

function ActionBar({
  state,
  p1Leader,
  p2Leader,
}: {
  state: BoardState;
  p1Leader: string;
  p2Leader: string;
}) {
  const logEntry: LogEntry = {
    turn: state.turn,
    player: state.actionPlayer,
    phase: '',
    action: state.actionType,
    details: state.actionDetails,
  };
  const display = formatAction(logEntry, p1Leader, p2Leader);

  return (
    <div
      className={`
        w-full rounded-lg border ${display.bgClass} px-4 py-2.5 text-center
        transition-all duration-300
        ${display.glowing ? 'shadow-[0_0_20px_rgba(234,179,8,0.3)]' : ''}
      `}
    >
      <span className={`text-sm font-medium ${display.colorClass}`}>
        {display.icon} {state.action}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player Half-Board
// ---------------------------------------------------------------------------

function PlayerBoard({
  player,
  isP1,
  isTop,
  highlightCards,
}: {
  player: PlayerBoardState;
  isP1: boolean;
  isTop: boolean;
  highlightCards: string[];
}) {
  const leaderHighlighted = highlightCards.includes(player.leader.name);
  const accentLabel = isP1 ? 'text-blue-400' : 'text-red-400';

  // For top player (P2), the layout is mirrored conceptually
  // Left column: Trash + Leader
  // Center: Character field (5 slots)
  // Right: Deck

  const fieldContent = (
    <div className="flex items-center gap-1.5 justify-center min-h-[110px] flex-wrap py-1">
      {player.field.length > 0 ? (
        player.field.map((card, i) => (
          <FieldCardSlot
            key={`${card.card_id || card.name}-${i}`}
            card={card}
            isP1={isP1}
            highlighted={highlightCards.includes(card.name)}
          />
        ))
      ) : (
        <div className="flex items-center justify-center h-[100px] w-full">
          <span className="text-xs text-gray-700 italic">No characters</span>
        </div>
      )}
    </div>
  );

  const handContent = isTop ? (
    // P2 hand: face-down
    <div className="flex items-center gap-1 justify-center flex-wrap py-1">
      {player.hand.length > 0 ? (
        <>
          {player.hand.map((_, i) => (
            <HandCardFaceDown key={`p2h-${i}`} />
          ))}
          <span className="text-[10px] text-gray-500 ml-2">({player.hand.length})</span>
        </>
      ) : (
        <span className="text-xs text-gray-600 italic">Empty hand</span>
      )}
    </div>
  ) : (
    // P1 hand: face-up
    <div className="flex items-center gap-1 justify-center flex-wrap py-1">
      {player.hand.length > 0 ? (
        player.hand.map((card, i) => (
          <HandCardFaceUp
            key={`p1h-${card.card_id || card.name}-${i}`}
            card={card}
            highlighted={highlightCards.includes(card.name)}
          />
        ))
      ) : (
        <span className="text-xs text-gray-600 italic">Empty hand</span>
      )}
    </div>
  );

  // Build the board row: Trash | Leader | Field | Deck
  const boardRow = (
    <div className="flex items-center gap-3 px-2">
      {/* Left column: Trash + Life */}
      <div className="flex flex-col items-center gap-2 shrink-0">
        <TrashPile count={player.trash} />
        <LifePile life={player.life} />
      </div>

      {/* Leader */}
      <div className="shrink-0">
        <LeaderCard leader={player.leader} isP1={isP1} highlighted={leaderHighlighted} />
      </div>

      {/* Character field */}
      <div className="flex-1 min-w-0">
        {fieldContent}
      </div>

      {/* Deck */}
      <div className="shrink-0">
        <DeckPile count={player.deckRemaining} />
      </div>
    </div>
  );

  // DON display
  const donRow = (
    <div className="flex items-center justify-between px-3 py-1">
      <span className={`text-xs font-semibold ${accentLabel}`}>
        {isP1 ? 'P1' : 'P2'} {'\u2014'} {player.leader.name}
      </span>
      <DonDisplay available={player.donAvailable} rested={player.donRested} donDeck={player.donDeck} />
    </div>
  );

  if (isTop) {
    // P2: hand on top, then DON, then board
    return (
      <div className="space-y-1">
        {handContent}
        {donRow}
        {boardRow}
      </div>
    );
  }

  // P1: board, then DON, then hand on bottom
  return (
    <div className="space-y-1">
      {boardRow}
      {donRow}
      {handContent}
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
  const [speed, setSpeed] = useState(1.0);
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
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/95 p-8 text-center text-sm text-gray-500">
        No game log data available for replay.
      </div>
    );
  }

  const winnerLabel =
    winner === 'p1' ? p1Leader : winner === 'p2' ? p2Leader : 'Draw';

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/95 overflow-hidden">
      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/80 border-b border-gray-700/60">
        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setCurrentStep(0); setIsPlaying(false); }}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors font-mono"
            title="Go to start"
          >
            |&lt;
          </button>
          <button
            onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors font-mono"
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
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors font-mono"
            title="Next step (Right arrow)"
          >
            &gt;
          </button>
          <button
            onClick={() => { setCurrentStep(totalSteps - 1); setIsPlaying(false); }}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700/50 rounded transition-colors font-mono"
            title="Go to end"
          >
            &gt;|
          </button>
        </div>

        {/* Step counter */}
        <span className="text-xs text-gray-400 font-mono">
          Step {currentStep + 1}/{totalSteps}
        </span>

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
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">Turn {state.turn}</span>
          <span className={`text-xs font-semibold ${state.activePlayer === 'p1' ? 'text-blue-400' : 'text-red-400'}`}>
            {state.activePlayer === 'p1' ? p1Leader : p2Leader}
          </span>
        </div>
      </div>

      {/* Progress scrubber */}
      <div className="px-4 py-1 bg-gray-800/40">
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

      {/* Board — OPTCG playmat style */}
      <div className="p-3 space-y-2">
        {/* P2 (opponent) — top half */}
        <div className={`rounded-lg border ${state.activePlayer === 'p2' ? 'border-red-700/50 bg-red-950/10' : 'border-gray-800/50 bg-gray-900/30'} p-2 transition-colors duration-300`}>
          <PlayerBoard
            player={state.p2}
            isP1={false}
            isTop={true}
            highlightCards={state.highlightCards}
          />
        </div>

        {/* Action bar — center divider */}
        {state.action && (
          <ActionBar state={state} p1Leader={p1Leader} p2Leader={p2Leader} />
        )}

        {/* P1 (player) — bottom half */}
        <div className={`rounded-lg border ${state.activePlayer === 'p1' ? 'border-blue-700/50 bg-blue-950/10' : 'border-gray-800/50 bg-gray-900/30'} p-2 transition-colors duration-300`}>
          <PlayerBoard
            player={state.p1}
            isP1={true}
            isTop={false}
            highlightCards={state.highlightCards}
          />
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
