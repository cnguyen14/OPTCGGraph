import { useState, useEffect } from 'react';
import type { GameProgressEntry } from '../../hooks/useSimulation';
import { GlassCard, Spinner } from '../../components/ui';

interface Props {
  gameResults: GameProgressEntry[];
  p1Leader: string | null;
  p2Leader: string | null;
  totalGames: number;
  isRunning: boolean;
  parallelGames?: number;
}

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

interface TurnData {
  turn: number;
  p1Actions: LogEntry[];
  p2Actions: LogEntry[];
  p1Hand: string[];
  p2Hand: string[];
  p1Life: number | null;
  p2Life: number | null;
  p1Don: number;
  p2Don: number;
  p1DonRested: number;
  p2DonRested: number;
  p1DonAttached: number;
  p2DonAttached: number;
  p1DonDeck: number;
  p2DonDeck: number;
  p1FieldDetails: FieldCard[];
  p2FieldDetails: FieldCard[];
}

// ---------------------------------------------------------------------------
// Action formatting with icons + colors
// ---------------------------------------------------------------------------

interface RichAction {
  icon: string;
  color: string;
  text: string;
}

function formatActionRich(entry: LogEntry): RichAction {
  const d = entry.details;
  switch (entry.action) {
    case 'play_card':
    case 'play_event':
      return {
        icon: '\u25B6',
        color: 'text-green-400',
        text: `Plays ${d.card_name ?? '?'} (cost ${d.cost ?? '?'})`,
      };
    case 'attack_declared':
      return {
        icon: '\u2694',
        color: 'text-orange-400',
        text: `${d.attacker ?? '?'} attacks ${d.target ?? '?'} (${d.attacker_power ?? '?'} vs ${d.target_power ?? '?'})`,
      };
    case 'attack_failed':
      return {
        icon: '\u2717',
        color: 'text-red-400/60',
        text: `Attack failed: ${d.attacker ?? '?'} (${d.attack_power ?? '?'}) < defense (${d.defense_power ?? '?'})`,
      };
    case 'life_lost':
      return {
        icon: '\u2764',
        color: 'text-red-400',
        text: `Loses life (${d.remaining ?? 0} left)`,
      };
    case 'character_koed':
      return {
        icon: '\u2620',
        color: 'text-red-500',
        text: `${d.card_name ?? '?'} KO'd`,
      };
    case 'attach_don':
      return {
        icon: '\u26A1',
        color: 'text-amber-400',
        text: `DON \u2192 ${d.card_name ?? '?'} (${d.new_power ?? '?'} power)`,
      };
    case 'add_don':
      return {
        icon: '+',
        color: 'text-amber-400',
        text: `+${d.amount ?? '?'} DON (total: ${d.total ?? '?'})`,
      };
    case 'counter_played':
      return {
        icon: '\u{1F6E1}',
        color: 'text-cyan-400',
        text: `Counters with ${d.card_name ?? '?'} (+${d.counter_value ?? 0})`,
      };
    case 'draw_card':
      return {
        icon: '\u{1F0CF}',
        color: 'text-blue-400',
        text: `Draws ${d.card_name ?? 'a card'}`,
      };
    case 'blocker_used':
      return {
        icon: '\u{1F6E1}',
        color: 'text-purple-400',
        text: `Blocks with ${d.blocker ?? '?'}`,
      };
    case 'final_blow':
      return {
        icon: '\u{1F4A5}',
        color: 'text-yellow-300 font-bold',
        text: `FINAL BLOW with ${d.attacker ?? '?'}!`,
      };
    case 'pass':
      return { icon: '\u2014', color: 'text-gray-500', text: 'Passes' };
    case 'card_rested':
      return {
        icon: '\u{1F4A4}',
        color: 'text-gray-500',
        text: `${d.card_name ?? '?'} rested`,
      };
    case 'deck_out':
      return { icon: '!', color: 'text-red-400 font-bold', text: 'Deck out!' };
    default:
      return { icon: '\u00B7', color: 'text-gray-400', text: entry.action };
  }
}

// ---------------------------------------------------------------------------
// Build turn data from log entries
// ---------------------------------------------------------------------------

function buildTurns(log: LogEntry[]): TurnData[] {
  const turnMap = new Map<number, TurnData>();

  for (const entry of log) {
    const t = entry.turn;
    if (!turnMap.has(t)) {
      turnMap.set(t, {
        turn: t,
        p1Actions: [],
        p2Actions: [],
        p1Hand: [],
        p2Hand: [],
        p1Life: null,
        p2Life: null,
        p1Don: 0,
        p2Don: 0,
        p1DonRested: 0,
        p2DonRested: 0,
        p1DonAttached: 0,
        p2DonAttached: 0,
        p1DonDeck: 10,
        p2DonDeck: 10,
        p1FieldDetails: [],
        p2FieldDetails: [],
      });
    }
    const td = turnMap.get(t)!;

    if (entry.action === 'start' && entry.phase === 'turn') {
      const d = entry.details;
      td.p1Hand = (d.p1_hand as string[]) ?? [];
      td.p2Hand = (d.p2_hand as string[]) ?? [];
      td.p1Life = (d.p1_life as number) ?? null;
      td.p2Life = (d.p2_life as number) ?? null;
      td.p1Don = (d.p1_don as number) ?? 0;
      td.p2Don = (d.p2_don as number) ?? 0;
      td.p1DonRested = (d.p1_don_rested as number) ?? 0;
      td.p2DonRested = (d.p2_don_rested as number) ?? 0;
      td.p1DonAttached = (d.p1_don_attached as number) ?? 0;
      td.p2DonAttached = (d.p2_don_attached as number) ?? 0;
      td.p1DonDeck = (d.p1_don_deck as number) ?? 10;
      td.p2DonDeck = (d.p2_don_deck as number) ?? 10;
      td.p1FieldDetails = (d.p1_field_details as FieldCard[]) ?? [];
      td.p2FieldDetails = (d.p2_field_details as FieldCard[]) ?? [];
      continue;
    }

    if (entry.action === 'game_initialized') continue;
    if (entry.phase === 'effect') continue;

    if (entry.player === 'p1') {
      td.p1Actions.push(entry);
    } else if (entry.player === 'p2') {
      td.p2Actions.push(entry);
    }
  }

  return [...turnMap.values()].sort((a, b) => a.turn - b.turn);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function PlayerStatus({
  life,
  don,
  donRested,
  donAttached,
  donDeck,
  handCount,
  fieldCount,
  color,
}: {
  life: number | null;
  don: number;
  donRested: number;
  donAttached: number;
  donDeck: number;
  handCount: number;
  fieldCount: number;
  color: 'blue' | 'red';
}) {
  const borderColor = color === 'blue' ? 'border-blue-500/30' : 'border-red-500/30';
  const bgColor = color === 'blue' ? 'bg-blue-950/30' : 'bg-red-950/30';
  return (
    <div className={`rounded-md border ${borderColor} ${bgColor} px-2.5 py-1.5 flex flex-wrap items-center gap-2`}>
      <Badge className="bg-red-900/60 text-red-300">
        <span className="text-red-400">{'\u2764'}</span> {life ?? '?'}
      </Badge>
      <Badge className="bg-amber-900/40 text-amber-300">
        <span className="text-amber-400">{'\u26A1'}</span>
        <span className="text-amber-200">{don}</span>
        <span className="text-[9px] text-amber-400/70">active</span>
      </Badge>
      {donAttached > 0 && (
        <Badge className="bg-orange-900/40 text-orange-300">
          {donAttached}
          <span className="text-[9px] text-orange-400/70">attached</span>
        </Badge>
      )}
      {donRested > 0 && (
        <Badge className="bg-amber-900/20 text-amber-400/70">
          {donRested}
          <span className="text-[9px] text-amber-500/50">rested</span>
        </Badge>
      )}
      <Badge className="bg-gray-800/60 text-gray-400">
        {donDeck}
        <span className="text-[9px] text-gray-500">deck</span>
      </Badge>
      <Badge className="bg-blue-900/40 text-blue-300">
        Hand {handCount}
      </Badge>
      <Badge className="bg-green-900/40 text-green-300">
        Field {fieldCount}
      </Badge>
    </div>
  );
}

function ActionLine({ entry }: { entry: LogEntry }) {
  const { icon, color, text } = formatActionRich(entry);
  return (
    <div className={`text-[11px] ${color} flex items-start gap-1.5 leading-relaxed`}>
      <span className="w-4 text-center shrink-0 mt-px">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function CollapsibleSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        {open ? '\u25BE' : '\u25B8'} {label} ({count})
      </button>
      {open && <div className="mt-0.5 ml-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game Panel (one game)
// ---------------------------------------------------------------------------

function GamePanel({
  result,
  p1Leader,
  p2Leader,
  defaultExpanded,
}: {
  result: GameProgressEntry;
  p1Leader: string | null;
  p2Leader: string | null;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const winnerLabel =
    result.winner === 'p1'
      ? `${p1Leader ?? 'P1'} won`
      : result.winner === 'p2'
        ? `${p2Leader ?? 'P2'} won`
        : 'Draw';
  const winnerColor =
    result.winner === 'p1' ? 'text-blue-400' : result.winner === 'p2' ? 'text-red-400' : 'text-gray-400';

  const turns = buildTurns(result.gameLog as LogEntry[]);

  return (
    <GlassCard variant="subtle" className="overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="text-xs text-text-muted shrink-0">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="text-sm font-medium text-text-secondary">
          Game {result.game}
        </span>
        <span className={`text-sm ${winnerColor}`}>
          {winnerLabel} in {result.turns} turns
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {result.p1Life} vs {result.p2Life} life
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-glass-border max-h-[600px] overflow-y-auto">
          {/* Column headers */}
          <div className="grid grid-cols-2 gap-0 sticky top-0 bg-surface-base/95 backdrop-blur-sm border-b border-glass-border z-10">
            <div className="px-4 py-2 text-xs font-semibold text-blue-400 border-r border-glass-border">
              P1 — {p1Leader ?? 'Player 1'}
              {result.firstPlayer === 'p1' && (
                <span className="ml-1.5 text-[10px] text-green-400/70 font-normal">(1st)</span>
              )}
            </div>
            <div className="px-4 py-2 text-xs font-semibold text-red-400">
              P2 — {p2Leader ?? 'Player 2'}
              {result.firstPlayer === 'p2' && (
                <span className="ml-1.5 text-[10px] text-green-400/70 font-normal">(1st)</span>
              )}
            </div>
          </div>

          {/* Turn rows */}
          {turns.map((td) => (
            <div key={td.turn} className="border-b border-glass-border/40 py-3 px-4">
              {/* Turn header */}
              <div className="text-xs font-semibold text-text-muted mb-2">
                Turn {td.turn}
              </div>

              {/* Status dashboard — 2 columns */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <PlayerStatus
                  life={td.p1Life}
                  don={td.p1Don}
                  donRested={td.p1DonRested}
                  donAttached={td.p1DonAttached}
                  donDeck={td.p1DonDeck}
                  handCount={td.p1Hand.length}
                  fieldCount={td.p1FieldDetails.length}
                  color="blue"
                />
                <PlayerStatus
                  life={td.p2Life}
                  don={td.p2Don}
                  donRested={td.p2DonRested}
                  donAttached={td.p2DonAttached}
                  donDeck={td.p2DonDeck}
                  handCount={td.p2Hand.length}
                  fieldCount={td.p2FieldDetails.length}
                  color="red"
                />
              </div>

              {/* Actions — 2 columns */}
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="space-y-0.5 min-h-[20px]">
                  {td.p1Actions.length > 0 ? (
                    td.p1Actions.map((e, i) => <ActionLine key={i} entry={e} />)
                  ) : (
                    <span className="text-[11px] text-gray-600 italic">No actions</span>
                  )}
                </div>
                <div className="space-y-0.5 min-h-[20px]">
                  {td.p2Actions.length > 0 ? (
                    td.p2Actions.map((e, i) => <ActionLine key={i} entry={e} />)
                  ) : (
                    <span className="text-[11px] text-gray-600 italic">No actions</span>
                  )}
                </div>
              </div>

              {/* Hand/Field collapsible — 2 columns */}
              <div className="grid grid-cols-2 gap-3 border-t border-glass-border/20 pt-1.5">
                <div className="flex gap-4">
                  <CollapsibleSection label="Hand" count={td.p1Hand.length}>
                    {td.p1Hand.map((c, i) => (
                      <div key={i} className="text-[10px] text-gray-500">{c}</div>
                    ))}
                  </CollapsibleSection>
                  <CollapsibleSection label="Field" count={td.p1FieldDetails.length}>
                    {td.p1FieldDetails.map((c, i) => (
                      <div key={i} className="text-[10px] text-gray-500">
                        {c.name} ({c.power}P {c.state === 'active' ? 'ACT' : 'RST'}
                        {c.don > 0 && ` +${c.don}DON`})
                      </div>
                    ))}
                  </CollapsibleSection>
                </div>
                <div className="flex gap-4">
                  <CollapsibleSection label="Hand" count={td.p2Hand.length}>
                    {td.p2Hand.map((c, i) => (
                      <div key={i} className="text-[10px] text-gray-500">{c}</div>
                    ))}
                  </CollapsibleSection>
                  <CollapsibleSection label="Field" count={td.p2FieldDetails.length}>
                    {td.p2FieldDetails.map((c, i) => (
                      <div key={i} className="text-[10px] text-gray-500">
                        {c.name} ({c.power}P {c.state === 'active' ? 'ACT' : 'RST'}
                        {c.don > 0 && ` +${c.don}DON`})
                      </div>
                    ))}
                  </CollapsibleSection>
                </div>
              </div>
            </div>
          ))}

          {result.gameLog.length === 0 && (
            <div className="px-4 py-3 text-xs text-text-muted text-center">
              No log data available
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function LiveGameFeed({ gameResults, p1Leader, p2Leader, totalGames, isRunning, parallelGames }: Props) {
  const completed = gameResults.length;
  const remaining = totalGames - completed;
  const batchSize = parallelGames && parallelGames > 1 ? Math.min(parallelGames, remaining) : 1;
  const hasGames = completed > 0;

  // Don't render anything until at least one game is completed
  if (!hasGames) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
        Game Log
        {isRunning && remaining > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-normal text-text-secondary">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            {batchSize > 1
              ? `${completed}/${totalGames} done`
              : `Game ${completed + 1} of ${totalGames}`}
          </span>
        )}
      </h3>

      {gameResults.map((result, i) => (
        <GamePanel
          key={result.game}
          result={result}
          p1Leader={p1Leader}
          p2Leader={p2Leader}
          defaultExpanded={i === gameResults.length - 1}
        />
      ))}

      {isRunning && remaining > 0 && (
        <GlassCard variant="subtle" className="border-dashed px-4 py-3">
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <span className="text-xs text-text-secondary">
              {batchSize > 1
                ? `${batchSize} games running in parallel...`
                : `Game ${completed + 1} running...`}
            </span>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
