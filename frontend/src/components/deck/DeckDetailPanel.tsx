import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeDeck, getDeckSimHistory, improveDeck } from '../../lib/api';
import type { SimHistoryEntry, DeckImprovement } from '../../types';

type TabId = 'analysis' | 'history' | 'improve';

interface DeckDetailPanelProps {
  deckId: string;
  leaderId: string;
  cardIds: string[];
  deckName: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      <span className="ml-2 text-sm text-gray-400">{text}</span>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-8 gap-3">
      <p className="text-sm text-red-400">{message}</p>
      <button
        onClick={onRetry}
        className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Analysis
// ---------------------------------------------------------------------------

function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(0);

  const retry = useCallback(() => {
    retryRef.current += 1;
    setData(null);
    setError(null);
    setLoading(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryRef.current]);

  return { data, loading, error, retry };
}

function AnalysisTab({ leaderId, cardIds }: { leaderId: string; cardIds: string[] }) {
  const { data, loading, error, retry } = useFetch(
    () => analyzeDeck(leaderId, cardIds),
    [leaderId, cardIds],
  );

  if (loading) return <Spinner text="Analyzing deck..." />;
  if (error) return <ErrorBox message={error} onRetry={retry} />;
  if (!data) return null;

  const { validation, playstyle, synergy_score, card_roles, cost_curve } = data;

  const maxCurveValue = Math.max(...Object.values(cost_curve), 1);

  const roleIcons: Record<string, string> = {
    blockers: '\u{1F6E1}',
    removal: '\u{1F5D1}',
    draw_search: '\u{1F50D}',
    rush: '\u{26A1}',
    finishers: '\u{2694}',
  };

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Rules"
          value={`${validation.pass_count} pass`}
          sub={validation.fail_count > 0 ? `${validation.fail_count} fail` : undefined}
          color={validation.fail_count > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="Warnings"
          value={String(validation.warning_count)}
          color={validation.warning_count > 0 ? 'yellow' : 'green'}
        />
        <StatCard
          label="Synergy"
          value={`${synergy_score}`}
          sub="/100"
          color={synergy_score >= 70 ? 'green' : synergy_score >= 40 ? 'yellow' : 'red'}
        />
        <StatCard label="Playstyle" value={playstyle} color="blue" />
      </div>

      {/* Cost curve */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Cost Curve
        </h4>
        <div className="space-y-1.5">
          {Object.entries(cost_curve)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([cost, count]) => (
              <div key={cost} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-8 text-right">{cost}</span>
                <div className="flex-1 h-4 bg-gray-700/50 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500/60 rounded transition-all duration-300"
                    style={{ width: `${(count / maxCurveValue) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 w-6">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Card roles */}
      <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Card Roles
        </h4>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(card_roles) as [string, number][]).map(([role, count]) => (
            <span
              key={role}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-700/60 text-xs text-gray-300"
            >
              <span>{roleIcons[role] ?? ''}</span>
              <span className="capitalize">{role.replace('_', ' ')}</span>
              <span className="text-gray-500">({count})</span>
            </span>
          ))}
        </div>
      </div>

      {/* Warnings / Fails */}
      {validation.checks.filter((c) => c.status !== 'pass').length > 0 && (
        <div className="rounded-lg bg-gray-800 border border-gray-700 p-4 space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Issues
          </h4>
          {validation.checks
            .filter((c) => c.status !== 'pass')
            .map((c, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 ${
                  c.status === 'fail'
                    ? 'bg-red-900/20 text-red-400'
                    : 'bg-yellow-900/20 text-yellow-400'
                }`}
              >
                <span className="font-medium shrink-0">{c.name}</span>
                <span className="text-gray-400">{c.message}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
}) {
  const colorMap = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
  };

  return (
    <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-lg font-bold ${colorMap[color]}`}>
        {value}
        {sub && <span className="text-xs text-gray-500 ml-0.5">{sub}</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Simulation History
// ---------------------------------------------------------------------------

function SimHistoryTab({ leaderId, cardIds }: { leaderId: string; cardIds: string[] }) {
  const { data, loading, error, retry } = useFetch(
    () => getDeckSimHistory(leaderId, cardIds).then((r) => r.simulations),
    [leaderId, cardIds],
  );

  if (loading) return <Spinner text="Loading simulation history..." />;
  if (error) return <ErrorBox message={error} onRetry={retry} />;

  const entries: SimHistoryEntry[] = data ?? [];

  if (entries.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-gray-500">
          No simulations yet. Run a simulation from the Simulator page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="grid grid-cols-6 gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-1">
        <span>Opponent</span>
        <span className="text-center">Win Rate</span>
        <span className="text-center">Games</span>
        <span className="text-center">Avg Turns</span>
        <span className="text-center">Mode</span>
        <span className="text-right">Date</span>
      </div>

      {entries.map((entry) => {
        const winColor =
          entry.win_rate > 60
            ? 'text-green-400'
            : entry.win_rate >= 40
              ? 'text-yellow-400'
              : 'text-red-400';

        return (
          <div
            key={entry.sim_id}
            className="grid grid-cols-6 gap-2 items-center rounded-lg bg-gray-800/50 border border-gray-700/40 px-3 py-2.5 text-xs"
          >
            <span className="text-gray-300 truncate" title={entry.opponent_leader}>
              {entry.opponent_leader}
            </span>
            <span className={`text-center font-semibold ${winColor}`}>
              {entry.win_rate.toFixed(1)}%
            </span>
            <span className="text-center text-gray-400">{entry.num_games}</span>
            <span className="text-center text-gray-400">{entry.avg_turns.toFixed(1)}</span>
            <span className="text-center text-gray-400 capitalize">{entry.mode}</span>
            <span className="text-right text-gray-500">
              {new Date(entry.timestamp).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Improve
// ---------------------------------------------------------------------------

function ImproveTab({ leaderId, cardIds }: { leaderId: string; cardIds: string[] }) {
  const { data, loading, error, retry } = useFetch(
    () => improveDeck(leaderId, cardIds),
    [leaderId, cardIds],
  );

  if (loading) return <Spinner text="AI is analyzing improvements..." />;
  if (error) return <ErrorBox message={error} onRetry={retry} />;
  if (!data) return null;

  const impactColor = (impact: string) => {
    switch (impact.toLowerCase()) {
      case 'high':
        return 'bg-red-900/30 text-red-400';
      case 'medium':
        return 'bg-yellow-900/30 text-yellow-400';
      default:
        return 'bg-gray-700/40 text-gray-400';
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      {data.summary && (
        <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
          <p className="text-sm text-gray-300 leading-relaxed">{data.summary}</p>
        </div>
      )}

      {/* Improvement cards */}
      {data.improvements.length === 0 && (
        <p className="text-center text-sm text-gray-500 py-8">
          No improvements suggested. Your deck looks great!
        </p>
      )}

      {data.improvements.map((imp: DeckImprovement, i: number) => (
        <div
          key={i}
          className="rounded-lg bg-gray-800 border border-gray-700 p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-400 uppercase">{imp.action}</span>
            <span
              className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${impactColor(imp.impact)}`}
            >
              {imp.impact}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Remove side */}
            {imp.remove && (
              <div className="flex-1 rounded-md bg-red-900/10 border border-red-900/30 p-3">
                <p className="text-[10px] font-semibold text-red-500 uppercase mb-1">Remove</p>
                <p className="text-sm text-red-300 font-medium">{imp.remove.card_name}</p>
                <p className="text-xs text-gray-500 mt-1">{imp.remove.reason}</p>
              </div>
            )}

            {/* Arrow */}
            {imp.remove && imp.add && (
              <span className="text-gray-600 text-lg shrink-0">&rarr;</span>
            )}

            {/* Add side */}
            {imp.add && (
              <div className="flex-1 rounded-md bg-green-900/10 border border-green-900/30 p-3">
                <p className="text-[10px] font-semibold text-green-500 uppercase mb-1">Add</p>
                <p className="text-sm text-green-300 font-medium">{imp.add.card_name}</p>
                <p className="text-xs text-gray-500 mt-1">{imp.add.reason}</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'history', label: 'Sim History' },
  { id: 'improve', label: 'Improve' },
];

export default function DeckDetailPanel({
  leaderId,
  cardIds,
  deckName,
  onClose,
}: DeckDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('analysis');

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/80 overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-gray-800/40">
        <h3 className="text-sm font-semibold text-white truncate">{deckName}</h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          aria-label="Close detail panel"
        >
          &times;
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-700/50 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'analysis' && <AnalysisTab leaderId={leaderId} cardIds={cardIds} />}
        {activeTab === 'history' && <SimHistoryTab leaderId={leaderId} cardIds={cardIds} />}
        {activeTab === 'improve' && <ImproveTab leaderId={leaderId} cardIds={cardIds} />}
      </div>
    </div>
  );
}
