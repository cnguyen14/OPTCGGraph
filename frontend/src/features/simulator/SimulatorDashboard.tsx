import { useState, useMemo } from 'react';
import type { SimulationResult, CardPerformance, TurnSnapshot } from '../../types';
import type { GameProgressEntry } from '../../hooks/useSimulation';
import BoardReplay from './BoardReplay';
import { GlassCard, Button } from '../../components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'cards' | 'timeline' | 'gamelog' | 'export';

type SortField =
  | 'card_name'
  | 'times_drawn'
  | 'times_played'
  | 'play_rate'
  | 'win_corr'
  | 'avg_turn_played'
  | 'damage_contributed'
  | 'times_koed'
  | 'times_countered_with'
  | 'times_blocked_with'
  | 'effects_triggered';

type SortDir = 'asc' | 'desc';

interface Props {
  result: SimulationResult;
  gameResults: GameProgressEntry[];
  simId: string | null;
  p1Leader: string | null;
  p2Leader: string | null;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'cards', label: 'Card Analysis' },
  { id: 'timeline', label: 'Game Timeline' },
  { id: 'gamelog', label: 'Game Log' },
  { id: 'export', label: 'Export' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (total === 0) return '0';
  return ((n / total) * 100).toFixed(1);
}

function StatCard({
  label,
  value,
  sublabel,
  color = 'gray',
}: {
  label: string;
  value: string;
  sublabel?: string;
  color?: 'blue' | 'red' | 'green' | 'yellow' | 'gray' | 'purple';
}) {
  const colorMap: Record<string, { border: string; bg: string; text: string }> = {
    blue: { border: 'border-blue-700/30', bg: 'bg-blue-950/20', text: 'text-blue-400' },
    red: { border: 'border-red-700/30', bg: 'bg-red-950/20', text: 'text-red-400' },
    green: { border: 'border-green-700/30', bg: 'bg-green-950/20', text: 'text-green-400' },
    yellow: { border: 'border-yellow-700/30', bg: 'bg-yellow-950/20', text: 'text-yellow-400' },
    purple: { border: 'border-purple-700/30', bg: 'bg-purple-950/20', text: 'text-purple-400' },
    gray: { border: 'border-gray-700/30', bg: 'bg-gray-800/20', text: 'text-white' },
  };
  const c = colorMap[color] ?? colorMap.gray;
  return (
    <GlassCard variant="subtle" className={`p-3 ${c.border} ${c.bg}`}>
      <div className="text-[11px] text-text-secondary mb-1">{label}</div>
      <div className={`text-xl font-bold ${c.text}`}>{value}</div>
      {sublabel && <div className="text-[10px] text-text-muted mt-1 truncate">{sublabel}</div>}
    </GlassCard>
  );
}

function LabeledBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-gray-400 w-20 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-5 bg-gray-800 rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${color}`}
          style={{ width: `${Math.max(w, 1)}%` }}
        />
      </div>
      <span className="text-[11px] text-gray-300 w-8 shrink-0">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ result }: { result: SimulationResult }) {
  const es = result.enhanced_stats;
  const totalWinConditions = (es?.win_by_lethal ?? 0) + (es?.win_by_deckout ?? 0) + (es?.win_by_timeout ?? 0);

  return (
    <div className="space-y-6">
      {/* Win rate cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="P1 Win Rate"
          value={`${result.p1_win_rate.toFixed(1)}%`}
          sublabel={result.p1_leader}
          color="blue"
        />
        <StatCard
          label="P2 Win Rate"
          value={`${result.p2_win_rate.toFixed(1)}%`}
          sublabel={result.p2_leader}
          color="red"
        />
        <StatCard
          label="Avg Game Length"
          value={`${result.avg_turns} turns`}
          sublabel={`${result.num_games} games played`}
        />
        <StatCard
          label="Draws"
          value={String(result.draws)}
          sublabel={`${pct(result.draws, result.num_games)}% draw rate`}
        />
      </div>

      {/* Win Distribution Bar */}
      <div className="glass-subtle p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Win Distribution</h3>
        <div className="flex h-8 rounded-lg overflow-hidden">
          {result.p1_wins > 0 && (
            <div
              className="bg-blue-500/80 flex items-center justify-center text-xs font-bold text-white transition-all"
              style={{ width: `${result.p1_win_rate}%` }}
            >
              {result.p1_wins}W
            </div>
          )}
          {result.draws > 0 && (
            <div
              className="bg-gray-600/80 flex items-center justify-center text-xs font-bold text-white transition-all"
              style={{ width: `${(result.draws / result.num_games) * 100}%` }}
            >
              {result.draws}D
            </div>
          )}
          {result.p2_wins > 0 && (
            <div
              className="bg-red-500/80 flex items-center justify-center text-xs font-bold text-white transition-all"
              style={{ width: `${result.p2_win_rate}%` }}
            >
              {result.p2_wins}W
            </div>
          )}
        </div>
        <div className="flex justify-between mt-2 text-[11px] text-gray-400">
          <span>{result.p1_leader}</span>
          <span>{result.p2_leader}</span>
        </div>
      </div>

      {/* Enhanced stats section */}
      {es && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Win Condition Breakdown */}
          <div className="glass-subtle p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Win Conditions</h3>
            <div className="space-y-2">
              <LabeledBar label="Lethal" value={es.win_by_lethal} max={totalWinConditions} color="bg-red-500/70" />
              <LabeledBar label="Deck Out" value={es.win_by_deckout} max={totalWinConditions} color="bg-amber-500/70" />
              <LabeledBar label="Timeout" value={es.win_by_timeout} max={totalWinConditions} color="bg-gray-500/70" />
            </div>
          </div>

          {/* Mulligan Stats */}
          <div className="glass-subtle p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Mulligan Analysis</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">P1 Mulligan Rate</span>
                <span className="text-blue-400 font-medium">{(es.mulligan_rate_p1 * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">P2 Mulligan Rate</span>
                <span className="text-red-400 font-medium">{(es.mulligan_rate_p2 * 100).toFixed(0)}%</span>
              </div>
              <div className="border-t border-gray-700/40 pt-2 flex justify-between text-xs">
                <span className="text-gray-400">Win Rate After Mulligan</span>
                <span className="text-yellow-400 font-medium">{(es.mulligan_win_rate * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>

          {/* First Player Advantage */}
          <div className="glass-subtle p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Turn Order Advantage</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">First Player Win Rate</span>
                <span className={`font-medium ${es.first_player_win_rate > 0.5 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {(es.first_player_win_rate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500/60 rounded-full transition-all"
                  style={{ width: `${es.first_player_win_rate * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>Going First</span>
                <span>Going Second</span>
              </div>
            </div>
          </div>

          {/* Combat Stats */}
          <div className="glass-subtle p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Combat Stats</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Avg Effects / Game</span>
                <span className="text-purple-400 font-medium">{es.avg_effects_per_game.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Avg P1 Damage</span>
                <span className="text-blue-400 font-medium">{es.avg_p1_damage.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Avg P2 Damage</span>
                <span className="text-red-400 font-medium">{es.avg_p2_damage.toFixed(1)}</span>
              </div>
              <div className="border-t border-gray-700/40 pt-2 flex justify-between text-xs">
                <span className="text-gray-400">Avg Decisions / Game</span>
                <span className="text-gray-300 font-medium">{es.avg_decisions_per_game.toFixed(0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Card Analysis
// ---------------------------------------------------------------------------

function CardAnalysisTab({ result }: { result: SimulationResult }) {
  const [sortField, setSortField] = useState<SortField>('times_played');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');

  const allCards = useMemo(() => Object.values(result.card_stats) as CardPerformance[], [result.card_stats]);

  const sortedCards = useMemo(() => {
    let filtered = allCards;
    if (search) {
      const q = search.toLowerCase();
      filtered = allCards.filter(
        (c) => (c.card_name || '').toLowerCase().includes(q) || c.card_id.toLowerCase().includes(q),
      );
    }

    return [...filtered].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;

      switch (sortField) {
        case 'card_name':
          av = (a.card_name || a.card_id).toLowerCase();
          bv = (b.card_name || b.card_id).toLowerCase();
          return sortDir === 'asc' ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
        case 'times_drawn':
          av = a.times_drawn ?? 0; bv = b.times_drawn ?? 0; break;
        case 'times_played':
          av = a.times_played; bv = b.times_played; break;
        case 'play_rate':
          av = a.times_drawn > 0 ? a.times_played / a.times_drawn : 0;
          bv = b.times_drawn > 0 ? b.times_played / b.times_drawn : 0;
          break;
        case 'win_corr':
          av = a.times_played > 0 ? a.times_in_winning_game / a.times_played : 0;
          bv = b.times_played > 0 ? b.times_in_winning_game / b.times_played : 0;
          break;
        case 'avg_turn_played':
          av = a.avg_turn_played ?? 0; bv = b.avg_turn_played ?? 0; break;
        case 'damage_contributed':
          av = a.damage_contributed ?? 0; bv = b.damage_contributed ?? 0; break;
        case 'times_koed':
          av = a.times_koed ?? 0; bv = b.times_koed ?? 0; break;
        case 'times_countered_with':
          av = a.times_countered_with ?? 0; bv = b.times_countered_with ?? 0; break;
        case 'times_blocked_with':
          av = a.times_blocked_with ?? 0; bv = b.times_blocked_with ?? 0; break;
        case 'effects_triggered':
          av = a.effects_triggered ?? 0; bv = b.effects_triggered ?? 0; break;
      }
      const diff = (av as number) - (bv as number);
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [allCards, sortField, sortDir, search]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortHeader({ field, label, className }: { field: SortField; label: string; className?: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => toggleSort(field)}
        className={`text-left text-[10px] font-medium hover:text-white transition-colors ${
          active ? 'text-blue-400' : 'text-gray-500'
        } ${className ?? ''}`}
      >
        {label}
        {active && <span className="ml-0.5">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
      </button>
    );
  }

  function winCorrColor(card: CardPerformance): string {
    if (card.times_played === 0) return 'text-gray-500';
    const rate = (card.times_in_winning_game / card.times_played) * 100;
    if (rate >= 65) return 'text-green-400';
    if (rate >= 45) return 'text-yellow-400';
    return 'text-red-400';
  }

  return (
    <div className="glass-subtle p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Card Performance ({allCards.length} cards)</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cards..."
          className="bg-surface-1 border border-glass-border rounded px-3 py-1 text-xs text-text-primary placeholder:text-text-muted w-48 focus:outline-none focus:border-op-ocean"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-gray-700/50">
              <th className="py-2 px-2 text-left"><SortHeader field="card_name" label="Card Name" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="times_drawn" label="Drawn" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="times_played" label="Played" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="play_rate" label="Play %" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="win_corr" label="Win %" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="avg_turn_played" label="Avg Turn" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="damage_contributed" label="Dmg" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="times_koed" label="KO'd" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="times_countered_with" label="Counter" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="times_blocked_with" label="Block" /></th>
              <th className="py-2 px-1 text-right"><SortHeader field="effects_triggered" label="Effects" /></th>
            </tr>
          </thead>
          <tbody>
            {sortedCards.map((card) => {
              const playRate = card.times_drawn > 0 ? ((card.times_played / card.times_drawn) * 100).toFixed(0) : '0';
              const winCorr = card.times_played > 0 ? ((card.times_in_winning_game / card.times_played) * 100).toFixed(0) : '0';
              return (
                <tr key={card.card_id} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                  <td className="py-1.5 px-2 text-gray-300 truncate max-w-[200px]">
                    {card.card_name || card.card_id}
                  </td>
                  <td className="py-1.5 px-1 text-right text-gray-400">{card.times_drawn ?? 0}</td>
                  <td className="py-1.5 px-1 text-right text-gray-300">{card.times_played}</td>
                  <td className="py-1.5 px-1 text-right text-gray-400">{playRate}%</td>
                  <td className={`py-1.5 px-1 text-right font-medium ${winCorrColor(card)}`}>{winCorr}%</td>
                  <td className="py-1.5 px-1 text-right text-gray-400">{(card.avg_turn_played ?? 0).toFixed(1)}</td>
                  <td className="py-1.5 px-1 text-right text-orange-400">{card.damage_contributed ?? 0}</td>
                  <td className="py-1.5 px-1 text-right text-red-400">{card.times_koed ?? 0}</td>
                  <td className="py-1.5 px-1 text-right text-cyan-400">{card.times_countered_with ?? 0}</td>
                  <td className="py-1.5 px-1 text-right text-purple-400">{card.times_blocked_with ?? 0}</td>
                  <td className="py-1.5 px-1 text-right text-amber-400">{card.effects_triggered ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedCards.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">
            {search ? 'No cards match your search' : 'No card data available'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Game Timeline
// ---------------------------------------------------------------------------

function TimelineLineChart({
  title,
  snapshots,
  getP1,
  getP2,
  maxVal,
  p1Color,
  p2Color,
}: {
  title: string;
  snapshots: TurnSnapshot[];
  getP1: (s: TurnSnapshot) => number;
  getP2: (s: TurnSnapshot) => number;
  maxVal: number;
  p1Color: string;
  p2Color: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 300;
  const H = 140;
  const padL = 28;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const safeMax = Math.max(maxVal, 1);
  const n = snapshots.length;

  const toX = (i: number) => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
  const toY = (v: number) => padT + chartH - (v / safeMax) * chartH;

  const buildPoints = (getter: (s: TurnSnapshot) => number) =>
    snapshots.map((s, i) => `${toX(i)},${toY(getter(s))}`).join(' ');

  const buildAreaPoints = (getter: (s: TurnSnapshot) => number) => {
    const line = snapshots.map((s, i) => `${toX(i)},${toY(getter(s))}`);
    return [...line, `${toX(n - 1)},${padT + chartH}`, `${toX(0)},${padT + chartH}`].join(' ');
  };

  // Y-axis grid lines (3 levels)
  const yTicks = [0, Math.round(safeMax / 2), safeMax];

  return (
    <div className="glass-subtle p-4">
      <h4 className="text-xs font-semibold text-white mb-2">{title}</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)}
              stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"
            />
            <text x={padL - 3} y={toY(v) + 3} textAnchor="end" fontSize="7" fill="rgba(255,255,255,0.3)">
              {v}
            </text>
          </g>
        ))}

        {/* Area fills */}
        <polygon points={buildAreaPoints(getP1)} fill={p1Color} opacity="0.12" />
        <polygon points={buildAreaPoints(getP2)} fill={p2Color} opacity="0.12" />

        {/* Lines */}
        <polyline points={buildPoints(getP1)} fill="none" stroke={p1Color} strokeWidth="2" strokeLinejoin="round" />
        <polyline points={buildPoints(getP2)} fill="none" stroke={p2Color} strokeWidth="2" strokeLinejoin="round" />

        {/* Data points */}
        {snapshots.map((s, i) => (
          <g key={i}>
            <circle cx={toX(i)} cy={toY(getP1(s))} r="2.5" fill={p1Color} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
            <circle cx={toX(i)} cy={toY(getP2(s))} r="2.5" fill={p2Color} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
          </g>
        ))}

        {/* X-axis turn labels */}
        {snapshots.map((s, i) => {
          // Show every label if <=10 turns, every other if <=20, every 3rd otherwise
          const step = n <= 10 ? 1 : n <= 20 ? 2 : 3;
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.35)">
              {s.turn}
            </text>
          );
        })}

        {/* Hover zones */}
        {snapshots.map((_, i) => (
          <rect
            key={i}
            x={toX(i) - chartW / n / 2}
            y={padT}
            width={chartW / n}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}

        {/* Hover tooltip */}
        {hoverIdx !== null && (() => {
          const s = snapshots[hoverIdx];
          const x = Math.min(Math.max(toX(hoverIdx), padL + 30), W - padR - 30);
          return (
            <g>
              <line x1={toX(hoverIdx)} y1={padT} x2={toX(hoverIdx)} y2={padT + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" strokeDasharray="2" />
              <rect x={x - 30} y={padT - 2} width="60" height="24" rx="3" fill="rgba(0,0,0,0.8)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
              <text x={x} y={padT + 8} textAnchor="middle" fontSize="7" fill={p1Color}>P1: {getP1(s)}</text>
              <text x={x} y={padT + 17} textAnchor="middle" fontSize="7" fill={p2Color}>P2: {getP2(s)}</text>
            </g>
          );
        })()}
      </svg>
      <div className="flex justify-center gap-4 mt-1 text-[9px]">
        <span style={{ color: p1Color }}>P1</span>
        <span style={{ color: p2Color }}>P2</span>
      </div>
    </div>
  );
}

function GameTimelineTab({ result }: { result: SimulationResult }) {
  const sampleGames = result.sample_games ?? [];
  const [selectedGame, setSelectedGame] = useState(0);

  if (sampleGames.length === 0) {
    return (
      <div className="glass-subtle p-6 text-center text-sm text-text-muted">
        No sample games with turn snapshots available.
      </div>
    );
  }

  const game = sampleGames[selectedGame];
  const snapshots: TurnSnapshot[] = game?.turn_snapshots ?? [];

  if (!game) return null;

  const maxLife = 6;
  const maxPower = Math.max(1, ...snapshots.map((s) => Math.max(s.p1.power, s.p2.power)));
  const maxDon = Math.max(1, ...snapshots.map((s) => Math.max(s.p1.don, s.p2.don)));

  return (
    <div className="space-y-4">
      {/* Game selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-400">Sample Game:</label>
        <select
          value={selectedGame}
          onChange={(e) => setSelectedGame(Number(e.target.value))}
          className="bg-surface-1 border border-glass-border rounded px-2 py-1 text-xs text-text-primary"
        >
          {sampleGames.map((g, i) => (
            <option key={i} value={i}>
              Game {i + 1} - {g.winner === 'p1' ? result.p1_leader : g.winner === 'p2' ? result.p2_leader : 'Draw'} wins ({g.turns} turns, {g.win_condition})
            </option>
          ))}
        </select>
      </div>

      {/* Game summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Winner" value={game.winner === 'p1' ? 'P1' : game.winner === 'p2' ? 'P2' : 'Draw'} color={game.winner === 'p1' ? 'blue' : game.winner === 'p2' ? 'red' : 'gray'} />
        <StatCard label="Turns" value={String(game.turns)} />
        <StatCard label="Win Condition" value={game.win_condition} />
        <StatCard label="Total Damage" value={`${game.p1_damage} / ${game.p2_damage}`} sublabel="P1 / P2" color="yellow" />
        <StatCard label="Decisions" value={String(game.decision_count)} color="purple" />
      </div>

      {/* Charts */}
      {snapshots.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TimelineLineChart
            title="Life Points"
            snapshots={snapshots}
            getP1={(s) => s.p1.life}
            getP2={(s) => s.p2.life}
            maxVal={maxLife}
            p1Color="#3b82f6"
            p2Color="#ef4444"
          />
          <TimelineLineChart
            title="Board Power"
            snapshots={snapshots}
            getP1={(s) => s.p1.power}
            getP2={(s) => s.p2.power}
            maxVal={maxPower}
            p1Color="#60a5fa"
            p2Color="#f87171"
          />
          <TimelineLineChart
            title="DON Available"
            snapshots={snapshots}
            getP1={(s) => s.p1.don}
            getP2={(s) => s.p2.don}
            maxVal={maxDon}
            p1Color="#f59e0b"
            p2Color="#b45309"
          />
        </div>
      )}

      {/* Snapshot Table */}
      {snapshots.length > 0 && (
        <div className="glass-subtle p-4">
          <h4 className="text-xs font-semibold text-white mb-3">Turn-by-Turn Breakdown</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-gray-700/50 text-gray-500">
                  <th className="py-1.5 px-2 text-left">Turn</th>
                  <th className="py-1.5 px-1 text-center">Active</th>
                  <th className="py-1.5 px-1 text-right text-blue-400/70">P1 Life</th>
                  <th className="py-1.5 px-1 text-right text-blue-400/70">P1 Hand</th>
                  <th className="py-1.5 px-1 text-right text-blue-400/70">P1 Field</th>
                  <th className="py-1.5 px-1 text-right text-blue-400/70">P1 Power</th>
                  <th className="py-1.5 px-1 text-right text-blue-400/70">P1 DON</th>
                  <th className="py-1.5 px-1 text-right text-red-400/70">P2 Life</th>
                  <th className="py-1.5 px-1 text-right text-red-400/70">P2 Hand</th>
                  <th className="py-1.5 px-1 text-right text-red-400/70">P2 Field</th>
                  <th className="py-1.5 px-1 text-right text-red-400/70">P2 Power</th>
                  <th className="py-1.5 px-1 text-right text-red-400/70">P2 DON</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.turn} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                    <td className="py-1 px-2 text-gray-300 font-medium">{s.turn}</td>
                    <td className="py-1 px-1 text-center">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        s.active === 'p1' ? 'bg-blue-900/40 text-blue-400' : 'bg-red-900/40 text-red-400'
                      }`}>
                        {s.active.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-1 px-1 text-right text-blue-300">{s.p1.life}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{s.p1.hand}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{s.p1.field}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{s.p1.power}</td>
                    <td className="py-1 px-1 text-right text-amber-400">{s.p1.don}</td>
                    <td className="py-1 px-1 text-right text-red-300">{s.p2.life}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{s.p2.hand}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{s.p2.field}</td>
                    <td className="py-1 px-1 text-right text-gray-400">{s.p2.power}</td>
                    <td className="py-1 px-1 text-right text-amber-400">{s.p2.don}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Game Log (wraps existing LiveGameFeed)
// ---------------------------------------------------------------------------

function GameLogTab({
  gameResults,
  p1Leader,
  p2Leader,
}: {
  gameResults: GameProgressEntry[];
  p1Leader: string | null;
  p2Leader: string | null;
}) {
  const [selectedGame, setSelectedGame] = useState(0);

  if (gameResults.length === 0) {
    return (
      <div className="glass-subtle p-8 text-center text-sm text-text-muted">
        No game data available for replay.
      </div>
    );
  }

  const game = gameResults[selectedGame];
  const winnerLabel =
    game.winner === 'p1'
      ? `P1 wins`
      : game.winner === 'p2'
        ? `P2 wins`
        : 'Draw';

  return (
    <div className="space-y-3">
      {/* Game selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-400 shrink-0">Replay game:</label>
        <select
          value={selectedGame}
          onChange={(e) => setSelectedGame(Number(e.target.value))}
          className="bg-surface-1 border border-glass-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
        >
          {gameResults.map((g, i) => (
            <option key={i} value={i}>
              Game {g.game} — {g.winner === 'p1' ? 'P1 wins' : g.winner === 'p2' ? 'P2 wins' : 'Draw'} ({g.turns} turns)
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">
          {winnerLabel} in {game.turns} turns | P1 {game.p1Life} life, P2 {game.p2Life} life
        </span>
      </div>

      {/* Board replay */}
      <BoardReplay
        gameLog={game.gameLog}
        p1Leader={p1Leader ?? 'Player 1'}
        p2Leader={p2Leader ?? 'Player 2'}
        winner={game.winner}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5: Export
// ---------------------------------------------------------------------------

function ExportTab({ result, simId }: { result: SimulationResult; simId: string | null }) {
  const [downloading, setDownloading] = useState<string | null>(null);

  if (!simId || !result.export_path) {
    return (
      <div className="glass-subtle p-6 text-center text-sm text-text-muted">
        No export data available for this simulation.
      </div>
    );
  }

  const es = result.enhanced_stats;

  const exports: {
    type: string;
    label: string;
    description: string;
    stat: string;
    icon: string;
  }[] = [
    {
      type: 'decisions',
      label: 'Decision Points',
      description: 'Every decision the AI agents made during the simulation, including context and chosen action.',
      stat: es ? `${es.total_decisions} decisions` : 'All decisions',
      icon: '\u{1F9E0}',
    },
    {
      type: 'games',
      label: 'Game Results',
      description: 'Complete results for each game including winner, turns, damage, effects, and card stats.',
      stat: `${result.num_games} games`,
      icon: '\u{1F3AE}',
    },
    {
      type: 'snapshots',
      label: 'Turn Snapshots',
      description: 'Board state captured each turn: life, hand size, field power, DON, deck size.',
      stat: `~${result.num_games * (result.avg_turns ?? 10)} snapshots`,
      icon: '\u{1F4F8}',
    },
    {
      type: 'metadata',
      label: 'Simulation Metadata',
      description: 'Configuration, deck lists, enhanced statistics, and summary of the entire simulation run.',
      stat: '1 file',
      icon: '\u{1F4CB}',
    },
  ];

  async function handleDownload(type: string) {
    if (!simId) return;
    setDownloading(type);
    try {
      const resp = await fetch(`/api/simulator/export/${simId}/${type}`);
      if (!resp.ok) throw new Error(`Export failed: ${resp.statusText}`);
      const blob = await resp.blob();
      const ext = type === 'metadata' ? 'json' : 'jsonl';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sim-${simId}-${type}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-subtle p-4">
        <h3 className="text-sm font-semibold text-white mb-1">Export Simulation Data</h3>
        <p className="text-[11px] text-gray-500 mb-4">
          Download detailed data from this {result.num_games}-game simulation for analysis or training.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {exports.map((exp) => (
            <button
              key={exp.type}
              onClick={() => handleDownload(exp.type)}
              disabled={downloading !== null}
              className="flex items-start gap-3 rounded-lg border border-gray-700/40 bg-gray-800/40 p-4 hover:bg-gray-800/70 hover:border-gray-600/50 transition-all text-left disabled:opacity-50"
            >
              <span className="text-xl mt-0.5">{exp.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">
                  {exp.label}
                  {exp.type === 'metadata' ? (
                    <span className="ml-2 text-[10px] text-gray-500">.json</span>
                  ) : (
                    <span className="ml-2 text-[10px] text-gray-500">.jsonl</span>
                  )}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">{exp.description}</div>
                <div className="text-[10px] text-gray-500 mt-1">{exp.stat}</div>
              </div>
              {downloading === exp.type ? (
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0 mt-1" />
              ) : (
                <span className="text-gray-500 shrink-0 mt-1">{'\u2193'}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function SimulatorDashboard({ result, gameResults, simId, p1Leader, p2Leader }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-glass-border">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            variant="ghost"
            size="sm"
            className={`border-b-2 rounded-b-none ${
              activeTab === tab.id
                ? 'border-op-ocean text-text-primary'
                : 'border-transparent text-text-muted'
            }`}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab result={result} />}
      {activeTab === 'cards' && <CardAnalysisTab result={result} />}
      {activeTab === 'timeline' && <GameTimelineTab result={result} />}
      {activeTab === 'gamelog' && (
        <GameLogTab
          gameResults={gameResults}
          p1Leader={p1Leader}
          p2Leader={p2Leader}
        />
      )}
      {activeTab === 'export' && <ExportTab result={result} simId={simId} />}
    </div>
  );
}
