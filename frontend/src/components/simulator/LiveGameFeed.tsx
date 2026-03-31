import { useState, useEffect, useRef } from 'react';
import type { GameProgressEntry } from '../../hooks/useSimulation';

interface Props {
  gameResults: GameProgressEntry[];
  p1Leader: string | null;
  p2Leader: string | null;
  totalGames: number;
  isRunning: boolean;
}

interface LogEntry {
  turn: number;
  player: string;
  phase: string;
  action: string;
  details: Record<string, unknown>;
}

interface TurnData {
  turn: number;
  p1Actions: LogEntry[];
  p2Actions: LogEntry[];
  p1Hand: string[];
  p2Hand: string[];
  p1Life: number | null;
  p2Life: number | null;
}

function formatAction(entry: LogEntry): string {
  const d = entry.details;
  switch (entry.action) {
    case 'play_card':
    case 'play_event':
      return `Plays ${d.card_name ?? '?'} (cost ${d.cost ?? '?'})`;
    case 'attack_declared':
      return `${d.attacker ?? '?'} attacks ${d.target ?? '?'} (${d.attacker_power ?? '?'} vs ${d.target_power ?? '?'})`;
    case 'life_lost':
      return `Loses life (${d.remaining ?? 0} left)`;
    case 'character_koed':
      return `${d.card_name ?? '?'} KO'd`;
    case 'attach_don':
      return `Attach DON → ${d.card_name ?? '?'} (${d.new_power ?? '?'} power)`;
    case 'final_blow':
      return `FINAL BLOW with ${d.attacker ?? '?'}!`;
    case 'blocker_used':
      return `Blocks with ${d.blocker ?? '?'}`;
    case 'counter_played':
      return `Counters with ${d.card_name ?? '?'} (+${d.counter_value ?? 0})`;
    case 'draw_card':
      return `Draws ${d.card_name ?? 'a card'}`;
    case 'add_don':
      return `+${d.amount ?? '?'} DON (total: ${d.total ?? '?'})`;
    case 'pass':
      return 'Passes';
    case 'attack_failed':
      return `Attack failed: ${d.attacker ?? '?'} (${d.attack_power ?? '?'}) < defense (${d.defense_power ?? '?'})`;
    case 'deck_out':
      return 'Deck out!';
    default:
      return entry.action;
  }
}

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
      });
    }
    const td = turnMap.get(t)!;

    // Extract hand/state from turn start events
    if (entry.action === 'start' && entry.phase === 'turn') {
      const d = entry.details;
      td.p1Hand = (d.p1_hand as string[]) ?? [];
      td.p2Hand = (d.p2_hand as string[]) ?? [];
      td.p1Life = (d.p1_life as number) ?? null;
      td.p2Life = (d.p2_life as number) ?? null;
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

function HandDisplay({ cards }: { cards: string[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="text-[9px] text-gray-600 italic mb-1 leading-snug">
      Hand: {cards.join(', ')}
    </div>
  );
}

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
    <div className="rounded-lg border border-gray-700/40 bg-gray-900/40 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/30 transition-colors text-left"
      >
        <span className="text-[10px] text-gray-500 shrink-0">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="text-xs font-medium text-gray-300">
          Game {result.game}
        </span>
        <span className={`text-xs ${winnerColor}`}>
          {winnerLabel} in {result.turns} turns
        </span>
        <span className="ml-auto text-[10px] text-gray-500">
          {result.p1Life} vs {result.p2Life} life
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-700/30 max-h-[500px] overflow-y-auto">
          {/* Column headers */}
          <div className="grid grid-cols-2 gap-0 sticky top-0 bg-gray-900/95 border-b border-gray-700/30 z-10">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-blue-400 border-r border-gray-700/30">
              P1 — {p1Leader ?? 'Player 1'}
              {result.firstPlayer === 'p1' && (
                <span className="ml-1.5 text-[9px] text-green-400/70 font-normal">(1st)</span>
              )}
            </div>
            <div className="px-3 py-1.5 text-[10px] font-semibold text-red-400">
              P2 — {p2Leader ?? 'Player 2'}
              {result.firstPlayer === 'p2' && (
                <span className="ml-1.5 text-[9px] text-green-400/70 font-normal">(1st)</span>
              )}
            </div>
          </div>

          {/* Turn rows */}
          {turns.map((td) => (
            <div key={td.turn} className="grid grid-cols-2 gap-0 border-b border-gray-800/30">
              {/* P1 column */}
              <div className="px-3 py-1.5 border-r border-gray-700/30 min-h-[28px]">
                <div className="text-[9px] text-gray-600 mb-0.5 flex items-center gap-2">
                  <span>Turn {td.turn}</span>
                  {td.p1Life !== null && (
                    <span className="text-blue-400/40">{td.p1Life} life</span>
                  )}
                </div>
                <HandDisplay cards={td.p1Hand} />
                {td.p1Actions.map((e, i) => (
                  <div key={i} className="text-[10px] text-gray-400 leading-relaxed">
                    {formatAction(e)}
                  </div>
                ))}
              </div>
              {/* P2 column */}
              <div className="px-3 py-1.5 min-h-[28px]">
                <div className="text-[9px] text-gray-600 mb-0.5 flex items-center gap-2">
                  <span>Turn {td.turn}</span>
                  {td.p2Life !== null && (
                    <span className="text-red-400/40">{td.p2Life} life</span>
                  )}
                </div>
                <HandDisplay cards={td.p2Hand} />
                {td.p2Actions.map((e, i) => (
                  <div key={i} className="text-[10px] text-gray-400 leading-relaxed">
                    {formatAction(e)}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {result.gameLog.length === 0 && (
            <div className="px-4 py-3 text-[10px] text-gray-500 text-center">
              No log data available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LiveGameFeed({ gameResults, p1Leader, p2Leader, totalGames, isRunning }: Props) {
  const currentGame = gameResults.length + 1;
  const hasGames = gameResults.length > 0;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        Game Log
        {isRunning && (
          <span className="flex items-center gap-1.5 text-xs font-normal text-gray-400">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            {currentGame <= totalGames
              ? `Game ${currentGame} of ${totalGames} in progress...`
              : 'Finishing up...'}
          </span>
        )}
      </h3>

      {/* Completed games */}
      {gameResults.map((result, i) => (
        <GamePanel
          key={result.game}
          result={result}
          p1Leader={p1Leader}
          p2Leader={p2Leader}
          defaultExpanded={i === gameResults.length - 1}
        />
      ))}

      {/* Current game placeholder */}
      {isRunning && currentGame <= totalGames && (
        <div className="rounded-lg border border-gray-700/40 border-dashed bg-gray-900/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-400">
              Game {currentGame} running...
            </span>
          </div>
        </div>
      )}

      {/* Empty state when no games yet */}
      {!hasGames && isRunning && (
        <div className="text-xs text-gray-500 text-center py-4">
          Waiting for first game to complete...
        </div>
      )}
    </div>
  );
}
