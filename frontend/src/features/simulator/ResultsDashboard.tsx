import { useMemo, useState } from 'react';
import type { SimulationResult, CardPerformance } from '../../types';
import { GlassCard, Button } from '../../components/ui';

interface Props {
  result: SimulationResult;
}

export default function ResultsDashboard({ result }: Props) {
  const [sortBy, setSortBy] = useState<'played' | 'winrate'>('played');

  const cardStats = useMemo(() => {
    const stats = Object.values(result.card_stats) as CardPerformance[];
    return stats.sort((a, b) => {
      if (sortBy === 'played') return b.times_played - a.times_played;
      const aWr = a.times_played > 0 ? a.times_in_winning_game / a.times_played : 0;
      const bWr = b.times_played > 0 ? b.times_in_winning_game / b.times_played : 0;
      return bWr - aWr;
    });
  }, [result.card_stats, sortBy]);

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="P1 Win Rate"
          value={`${result.p1_win_rate}%`}
          sublabel={result.p1_leader}
          color="blue"
        />
        <StatCard
          label="P2 Win Rate"
          value={`${result.p2_win_rate}%`}
          sublabel={result.p2_leader}
          color="red"
        />
        <StatCard
          label="Avg Game Length"
          value={`${result.avg_turns} turns`}
          sublabel={`${result.num_games} games played`}
          color="gray"
        />
        <StatCard
          label="Draws"
          value={String(result.draws)}
          sublabel={`${((result.draws / result.num_games) * 100).toFixed(0)}% draw rate`}
          color="gray"
        />
      </div>

      {/* Win Rate Bar */}
      <GlassCard className="p-4">
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
        <div className="flex justify-between mt-2 text-[11px] text-text-secondary">
          <span>{result.p1_leader}</span>
          <span>{result.p2_leader}</span>
        </div>
      </GlassCard>

      {/* Card Performance Table */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Card Performance</h3>
          <div className="flex gap-1">
            <Button
              onClick={() => setSortBy('played')}
              variant={sortBy === 'played' ? 'primary' : 'ghost'}
              size="sm"
              className="text-[11px]"
            >
              Most Played
            </Button>
            <Button
              onClick={() => setSortBy('winrate')}
              variant={sortBy === 'winrate' ? 'primary' : 'ghost'}
              size="sm"
              className="text-[11px]"
            >
              Win Rate
            </Button>
          </div>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {cardStats.slice(0, 20).map((card) => {
            const winRate = card.times_played > 0
              ? ((card.times_in_winning_game / card.times_played) * 100).toFixed(0)
              : '0';
            return (
              <div
                key={card.card_id}
                className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-surface-2"
              >
                <span className="text-[11px] text-text-secondary flex-1 truncate">
                  {card.card_name || card.card_id}
                </span>
                <span className="text-[10px] text-text-muted w-16 text-right">
                  {card.times_played}x played
                </span>
                <span className="text-[10px] w-14 text-right font-medium" style={{
                  color: Number(winRate) >= 60 ? '#4ade80' : Number(winRate) >= 40 ? '#facc15' : '#f87171',
                }}>
                  {winRate}% WR
                </span>
              </div>
            );
          })}
          {cardStats.length === 0 && (
            <p className="text-xs text-text-muted text-center py-4">No card data available</p>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  color,
}: {
  label: string;
  value: string;
  sublabel: string;
  color: 'blue' | 'red' | 'gray';
}) {
  const colorClasses = {
    blue: 'border-blue-700/30 bg-blue-950/20',
    red: 'border-red-700/30 bg-red-950/20',
    gray: 'border-gray-700/30 bg-gray-800/20',
  };

  const valueColors = {
    blue: 'text-blue-400',
    red: 'text-red-400',
    gray: 'text-white',
  };

  return (
    <GlassCard variant="subtle" className={`p-3 ${colorClasses[color]}`}>
      <div className="text-[11px] text-text-secondary mb-1">{label}</div>
      <div className={`text-xl font-bold ${valueColors[color]}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-1 truncate">{sublabel}</div>
    </GlassCard>
  );
}
