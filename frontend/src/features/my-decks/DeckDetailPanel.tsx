import { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeDeck, getDeckSimHistory, improveDeck, fetchSimDetail, analyzeMatchup, aggregateDeckAnalysis, clearSimHistory, fetchCard } from '../../lib/api';
import type { SimHistoryEntry, DeckImprovement, MatchupAnalysis, DeckHealthAnalysis, Card, DeckEntry } from '../../types';
import SwapConfirmModal from './SwapConfirmModal';
import type { SwapWithCandidates } from './SwapConfirmModal';
import DeckMap from '../deck-builder/DeckMap';
import { GlassCard, Button } from '../../components/ui';

type TabId = 'decklist' | 'deckmap' | 'analysis' | 'history' | 'improve';

const CHECK_LABELS: Record<string, string> = {
  DECK_SIZE: 'Deck Size',
  COPY_LIMIT: 'Copy Limit',
  COLOR_MATCH: 'Color Match',
  LEADER_VALID: 'Leader Valid',
  NO_LEADER_IN_DECK: 'No Leader in Deck',
  BANNED_CARDS: 'Banned Cards',
  COST_CURVE: 'Cost Curve',
  COUNTER_DENSITY: 'Counter Density',
  TYPE_RATIO: 'Card Type Ratio',
  FOUR_COPY_CORE: 'Core Consistency (4x)',
  WIN_CONDITION: 'Win Condition',
  BLOCKER_COUNT: 'Blockers',
  DRAW_ENGINE: 'Draw / Search Engine',
  REMOVAL_OPTIONS: 'Removal Options',
};

interface DeckDetailPanelProps {
  deckId: string;
  leaderId: string;
  cardIds: string[];
  deckName: string;
  onClose: () => void;
  onOpenBuilder?: () => void;
  onSimulate?: () => void;
  onDelete?: () => void;
  onDeckChanged?: () => void;
  isConfirmingDelete?: boolean;
  isDeletingDeck?: boolean;
  onCancelDelete?: () => void;
  isActionLoading?: boolean;
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

// ---------------------------------------------------------------------------
// Tab 0: Deck List
// ---------------------------------------------------------------------------

interface DeckCard {
  card_id: string;
  name: string;
  image_small: string;
  card_type: string;
  cost: number;
  power: number;
  counter: number;
  quantity: number;
}

function DeckListTab({ leaderId, cardIds }: { leaderId: string; cardIds: string[] }) {
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Count quantities
      const counts = new Map<string, number>();
      for (const id of cardIds) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      // Fetch unique cards
      const uniqueIds = [...counts.keys()];
      const fetched: DeckCard[] = [];
      // Also fetch leader
      try {
        const leaderData = await fetchCard(leaderId);
        if (!cancelled && leaderData) {
          fetched.push({
            card_id: leaderData.id,
            name: leaderData.name,
            image_small: leaderData.image_small || '',
            card_type: 'LEADER',
            cost: leaderData.cost ?? 0,
            power: leaderData.power ?? 0,
            counter: 0,
            quantity: 1,
          });
        }
      } catch { /* skip leader if not found */ }
      await Promise.all(
        uniqueIds.map(async (id) => {
          try {
            const data = await fetchCard(id);
            if (!cancelled && data) {
              fetched.push({
                card_id: data.id,
                name: data.name,
                image_small: data.image_small || '',
                card_type: data.card_type || 'CHARACTER',
                cost: data.cost ?? 0,
                power: data.power ?? 0,
                counter: data.counter ?? 0,
                quantity: counts.get(id) || 1,
              });
            }
          } catch { /* skip */ }
        }),
      );
      if (!cancelled) {
        // Sort: leader first, then by cost
        fetched.sort((a, b) => {
          if (a.card_type === 'LEADER') return -1;
          if (b.card_type === 'LEADER') return 1;
          return a.cost - b.cost || a.name.localeCompare(b.name);
        });
        setCards(fetched);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leaderId, cardIds]);

  if (loading) return <Spinner text="Loading deck cards..." />;

  const totalCards = cards.reduce((sum, c) => sum + (c.card_type === 'LEADER' ? 0 : c.quantity), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{totalCards} cards ({cards.length - 1} unique)</span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`text-[10px] px-2 py-0.5 rounded ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >Grid</button>
          <button
            onClick={() => setViewMode('list')}
            className={`text-[10px] px-2 py-0.5 rounded ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >List</button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="flex flex-wrap gap-1.5">
          {cards.map((card) => (
            <div
              key={card.card_id}
              className="relative cursor-pointer hover:scale-105 transition-transform"
              onClick={() => card.image_small && setPreviewImage(card.image_small)}
              title={`${card.card_id} ${card.name} | Cost ${card.cost} | Power ${card.power}`}
            >
              {card.image_small ? (
                <img
                  src={card.image_small}
                  alt={card.name}
                  className={`w-[56px] h-[78px] rounded object-cover border ${
                    card.card_type === 'LEADER' ? 'border-yellow-500' : 'border-gray-700'
                  }`}
                />
              ) : (
                <div className="w-[56px] h-[78px] rounded border border-gray-700 bg-gray-800 flex items-center justify-center">
                  <span className="text-[8px] text-gray-500 text-center px-0.5">{card.name}</span>
                </div>
              )}
              {card.quantity > 1 && (
                <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {card.quantity}
                </span>
              )}
              {card.card_type === 'LEADER' && (
                <span className="absolute bottom-0 left-0 right-0 bg-yellow-600/80 text-[7px] text-white text-center rounded-b">
                  LEADER
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {cards.map((card) => (
            <div
              key={card.card_id}
              className="flex items-center gap-2 bg-gray-800/50 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-700/50"
              onClick={() => card.image_small && setPreviewImage(card.image_small)}
            >
              {card.image_small ? (
                <img src={card.image_small} alt="" className="w-8 h-[45px] rounded object-cover shrink-0" />
              ) : (
                <div className="w-8 h-[45px] rounded bg-gray-700 shrink-0" />
              )}
              <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">{card.card_id}</span>
              <span className={`flex-1 truncate ${card.card_type === 'LEADER' ? 'text-yellow-400 font-semibold' : 'text-gray-300'}`}>
                {card.name}
              </span>
              <span className="text-gray-500 w-8 text-right">{card.cost > 0 ? `C${card.cost}` : ''}</span>
              <span className="text-gray-500 w-12 text-right">{card.power > 0 ? `${card.power}P` : ''}</span>
              <span className="text-blue-400 font-semibold w-5 text-right">x{card.quantity}</span>
            </div>
          ))}
        </div>
      )}

      {/* Full image preview */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center cursor-pointer"
          onClick={() => setPreviewImage(null)}
        >
          <img src={previewImage} alt="" className="max-h-[50vh] max-w-[60vw] rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Deck Map (D3 synergy visualization)
// ---------------------------------------------------------------------------

function DeckMapTab({ leaderId, cardIds }: { leaderId: string; cardIds: string[] }) {
  const [leader, setLeader] = useState<Card | null>(null);
  const [entries, setEntries] = useState<Map<string, DeckEntry>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const counts = new Map<string, number>();
      for (const id of cardIds) counts.set(id, (counts.get(id) || 0) + 1);

      try {
        const ld = await fetchCard(leaderId);
        if (!cancelled && ld) setLeader(ld as Card);
      } catch { /* skip */ }

      const entryMap = new Map<string, DeckEntry>();
      await Promise.all(
        [...counts.keys()].map(async (id) => {
          try {
            const card = await fetchCard(id);
            if (!cancelled && card) {
              entryMap.set(id, { card: card as Card, quantity: counts.get(id) || 1 });
            }
          } catch { /* skip */ }
        }),
      );
      if (!cancelled) {
        setEntries(entryMap);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leaderId, cardIds]);

  const [fullscreen, setFullscreen] = useState(false);

  if (loading) return <Spinner text="Loading deck map..." />;

  if (fullscreen) {
    return (
      <>
        <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900">
            <span className="text-sm text-gray-300">Deck Map — {entries.size} cards</span>
            <button onClick={() => setFullscreen(false)} className="text-gray-400 hover:text-white text-lg">&times;</button>
          </div>
          <div className="flex-1">
            <DeckMap leader={leader} entries={entries} onCardSelect={() => {}} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-end mb-2 shrink-0">
        <button
          onClick={() => setFullscreen(true)}
          className="text-[10px] text-blue-400 hover:text-blue-300"
        >
          Fullscreen
        </button>
      </div>
      <div className="border border-gray-700 rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
        <DeckMap leader={leader} entries={entries} onCardSelect={() => {}} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Analysis
// ---------------------------------------------------------------------------

function AnalysisTab({ leaderId, cardIds, healthData, onHealthReportChange }: {
  leaderId: string;
  cardIds: string[];
  healthData?: DeckHealthAnalysis | null;
  onHealthReportChange?: (report: DeckHealthAnalysis | null) => void;
}) {
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
      <div className="glass-subtle p-4">
        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Cost Curve
        </h4>
        <div className="space-y-1.5">
          {Object.entries(cost_curve)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([cost, count]) => (
              <div key={cost} className="flex items-center gap-2">
                <span className="text-xs text-text-secondary w-8 text-right">{cost}</span>
                <div className="flex-1 h-4 bg-gray-700/50 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500/60 rounded transition-all duration-300"
                    style={{ width: `${(count / maxCurveValue) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-text-primary w-6">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Card roles */}
      <div className="glass-subtle p-4">
        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Card Roles
        </h4>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(card_roles) as [string, number][]).map(([role, count]) => (
            <span
              key={role}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-700/60 text-xs text-text-primary"
            >
              <span>{roleIcons[role] ?? ''}</span>
              <span className="capitalize">{role.replace('_', ' ')}</span>
              <span className="text-text-secondary">({count})</span>
            </span>
          ))}
        </div>
      </div>

      {/* Warnings / Fails */}
      {validation.checks.filter((c) => c.status.toUpperCase() !== 'PASS').length > 0 && (
        <div className="glass-subtle p-4 space-y-2">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1">
            Issues
          </h4>
          {validation.checks
            .filter((c) => c.status.toUpperCase() !== 'PASS')
            .map((c, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 ${
                  c.status.toUpperCase() === 'FAIL'
                    ? 'bg-red-900/20 text-red-400'
                    : 'bg-yellow-900/20 text-yellow-400'
                }`}
              >
                <span className="font-medium shrink-0">{CHECK_LABELS[c.name] ?? c.name}</span>
                <span className="text-text-secondary">{c.message}</span>
              </div>
            ))}
        </div>
      )}

      {/* Deck Health — Aggregate Analysis */}
      <AnalysisDeckHealth leaderId={leaderId} cardIds={cardIds} healthData={healthData} onHealthReportChange={onHealthReportChange} />

      {/* Deck vs Deck — Per-Matchup Analysis */}
      <AnalysisDeckVsDeck leaderId={leaderId} cardIds={cardIds} />
    </div>
  );
}

function AnalysisDeckHealth({ leaderId, cardIds, healthData, onHealthReportChange }: {
  leaderId: string;
  cardIds: string[];
  healthData?: DeckHealthAnalysis | null;
  onHealthReportChange?: (report: DeckHealthAnalysis | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(() => {
    setLoading(true);
    setError(null);
    aggregateDeckAnalysis(leaderId, cardIds)
      .then((report) => onHealthReportChange?.(report))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [leaderId, cardIds, onHealthReportChange]);

  return (
    <div className="glass-subtle p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
          Deck Health — Overall Performance
        </h4>
        {!healthData && (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] px-3 py-1 rounded transition-colors"
          >
            {loading ? 'Analyzing...' : 'Generate'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!healthData && !loading && (
        <p className="text-[10px] text-gray-500">Run 2+ simulations then generate to see aggregate deck health analysis.</p>
      )}
      {healthData && (
        <div className="space-y-3">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-gray-800/60 rounded p-2 text-center">
              <div className="text-sm font-bold text-gray-200">{healthData.total_sims}</div>
              <div className="text-[9px] text-gray-500 uppercase">Sims</div>
            </div>
            <div className="bg-gray-800/60 rounded p-2 text-center">
              <div className="text-sm font-bold text-gray-200">{healthData.total_games}</div>
              <div className="text-[9px] text-gray-500 uppercase">Games</div>
            </div>
            <div className="bg-gray-800/60 rounded p-2 text-center">
              <div className={`text-sm font-bold ${healthData.overall_win_rate > 0.6 ? 'text-green-400' : healthData.overall_win_rate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                {(healthData.overall_win_rate * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] text-gray-500 uppercase">Win Rate</div>
            </div>
            <div className="bg-gray-800/60 rounded p-2 text-center">
              <div className="text-sm font-bold capitalize text-gray-200">{healthData.consistency_rating}</div>
              <div className="text-[9px] text-gray-500 uppercase">Consistency</div>
            </div>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{healthData.summary}</p>
          {/* Strengths / Weaknesses */}
          <div className="grid grid-cols-2 gap-3">
            {healthData.strengths.length > 0 && (
              <div>
                <h5 className="text-[10px] font-semibold text-green-400 uppercase mb-1">Strengths</h5>
                <ul className="space-y-0.5">
                  {healthData.strengths.map((s, i) => (
                    <li key={i} className="text-[10px] text-green-300/80 flex items-start gap-1">
                      <span className="text-green-500 shrink-0">+</span><span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {healthData.weaknesses.length > 0 && (
              <div>
                <h5 className="text-[10px] font-semibold text-yellow-400 uppercase mb-1">Weaknesses</h5>
                <ul className="space-y-0.5">
                  {healthData.weaknesses.map((w, i) => (
                    <li key={i} className="text-[10px] text-yellow-300/80 flex items-start gap-1">
                      <span className="text-yellow-500 shrink-0">!</span><span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {/* Core engine + Dead cards compact */}
          {healthData.core_engine.length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">Core Engine</h5>
              <div className="flex flex-wrap gap-1">
                {healthData.core_engine.map((c) => (
                  <span key={c.card_id} className="bg-emerald-900/20 border border-emerald-900/30 text-emerald-300 text-[10px] px-2 py-0.5 rounded">
                    {c.card_name || c.card_id}
                  </span>
                ))}
              </div>
            </div>
          )}
          {healthData.dead_cards.length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold text-red-400 uppercase mb-1">Dead Cards</h5>
              <div className="flex flex-wrap gap-1">
                {healthData.dead_cards.map((c) => (
                  <span key={c.card_id} className="bg-red-900/20 border border-red-900/30 text-red-300 text-[10px] px-2 py-0.5 rounded">
                    {c.card_name || c.card_id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisDeckVsDeck({ leaderId, cardIds }: { leaderId: string; cardIds: string[] }) {
  const { data: histData } = useFetch(
    () => getDeckSimHistory(leaderId, cardIds).then((r) => r.simulations),
    [leaderId, cardIds],
  );

  const [selectedSimId, setSelectedSimId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MatchupAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handleAnalyze = useCallback((simId: string) => {
    setSelectedSimId(simId);
    setAnalysis(null);
    setAnalysisLoading(true);
    setAnalysisError(null);
    analyzeMatchup(leaderId, cardIds, simId)
      .then(setAnalysis)
      .catch((e: Error) => setAnalysisError(e.message))
      .finally(() => setAnalysisLoading(false));
  }, [leaderId, cardIds]);

  const entries = histData ?? [];

  return (
    <div className="glass-subtle p-4 space-y-3">
      <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
        Deck vs Deck — Matchup Analysis
      </h4>
      {entries.length === 0 && (
        <p className="text-[10px] text-gray-500">No simulations available. Run a simulation first.</p>
      )}
      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {entries.map((entry) => {
              const isSelected = selectedSimId === entry.sim_id;
              const winColor = entry.win_rate > 60 ? 'border-green-500/50' : entry.win_rate >= 40 ? 'border-yellow-500/50' : 'border-red-500/50';
              return (
                <button
                  key={entry.sim_id}
                  onClick={() => handleAnalyze(entry.sim_id)}
                  className={`text-[10px] px-2.5 py-1.5 rounded border transition-colors ${
                    isSelected
                      ? 'bg-purple-900/30 border-purple-500/50 text-purple-300'
                      : `bg-gray-800/40 ${winColor} text-gray-400 hover:text-gray-200`
                  }`}
                >
                  vs {entry.opponent_leader} ({entry.win_rate.toFixed(0)}%)
                </button>
              );
            })}
          </div>

          {analysisLoading && <Spinner text="Analyzing matchup..." />}
          {analysisError && <p className="text-xs text-red-400">{analysisError}</p>}

          {analysis && (
            <div className="space-y-2 mt-2">
              <p className="text-xs text-gray-300 leading-relaxed">{analysis.analysis}</p>
              <div className="grid grid-cols-2 gap-3">
                {analysis.strengths.length > 0 && (
                  <div>
                    <h5 className="text-[10px] font-semibold text-green-400 uppercase mb-1">Strengths</h5>
                    <ul className="space-y-0.5">
                      {analysis.strengths.map((s, i) => (
                        <li key={i} className="text-[10px] text-green-300/80 flex items-start gap-1">
                          <span className="text-green-500 shrink-0">+</span><span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.weaknesses.length > 0 && (
                  <div>
                    <h5 className="text-[10px] font-semibold text-yellow-400 uppercase mb-1">Weaknesses</h5>
                    <ul className="space-y-0.5">
                      {analysis.weaknesses.map((w, i) => (
                        <li key={i} className="text-[10px] text-yellow-300/80 flex items-start gap-1">
                          <span className="text-yellow-500 shrink-0">!</span><span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {analysis.overperformers.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">Overperformers</h5>
                  <div className="flex flex-wrap gap-1">
                    {analysis.overperformers.map((c) => (
                      <span key={c.card_id} className="bg-emerald-900/20 border border-emerald-900/30 text-emerald-300 text-[10px] px-2 py-0.5 rounded">
                        {c.card_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.underperformers.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold text-orange-400 uppercase mb-1">Underperformers</h5>
                  <div className="flex flex-wrap gap-1">
                    {analysis.underperformers.map((c) => (
                      <span key={c.card_id} className="bg-orange-900/20 border border-orange-900/30 text-orange-300 text-[10px] px-2 py-0.5 rounded">
                        {c.card_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
    <GlassCard variant="subtle" className="p-4">
      <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-lg font-bold ${colorMap[color]}`}>
        {value}
        {sub && <span className="text-xs text-text-secondary ml-0.5">{sub}</span>}
      </p>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Simulation History
// ---------------------------------------------------------------------------

function SimDetailPanel({
  simId,
}: {
  simId: string;
}) {
  const {
    data: detail,
    loading: detailLoading,
    error: detailError,
  } = useFetch(() => fetchSimDetail(simId), [simId]);

  if (detailLoading) return <Spinner text="Loading game details..." />;
  if (detailError) return <p className="text-xs text-red-400 py-2 px-3">{detailError}</p>;
  if (!detail) return null;

  const { metadata, games } = detail;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-4">
      {/* Metadata summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
        <span>
          vs <span className="text-gray-200 font-medium">{metadata.p2_leader}</span>
        </span>
        <span className="text-gray-600">|</span>
        <span>{metadata.num_games} games</span>
        <span className="text-gray-600">|</span>
        <span className="capitalize">{metadata.mode}</span>
        {metadata.llm_model && (
          <>
            <span className="text-gray-600">|</span>
            <span>{metadata.llm_model}</span>
          </>
        )}
        <span className="text-gray-600">|</span>
        <span>
          P1: <span className="capitalize">{metadata.p1_level}</span> vs P2:{' '}
          <span className="capitalize">{metadata.p2_level}</span>
        </span>
      </div>

      {/* Games table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-700/50">
              <th className="py-1.5 px-2 text-left">#</th>
              <th className="py-1.5 px-2 text-left">Winner</th>
              <th className="py-1.5 px-2 text-center">Turns</th>
              <th className="py-1.5 px-2 text-center">P1 Life</th>
              <th className="py-1.5 px-2 text-center">P2 Life</th>
              <th className="py-1.5 px-2 text-center">Damage</th>
              <th className="py-1.5 px-2 text-center">Effects</th>
              <th className="py-1.5 px-2 text-center">Mulligan</th>
              <th className="py-1.5 px-2 text-left">Condition</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const isP1Win = g.winner === 'p1';
              return (
                <tr
                  key={g.game_idx}
                  className="border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors"
                >
                  <td className="py-1.5 px-2 text-gray-500">{g.game_idx}</td>
                  <td className="py-1.5 px-2">
                    <span
                      className={`font-medium ${isP1Win ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {g.winner.toUpperCase()}
                    </span>
                    {isP1Win && <span className="ml-1 text-green-600 text-[10px]">W</span>}
                  </td>
                  <td className="py-1.5 px-2 text-center text-gray-400">{g.turns}</td>
                  <td className="py-1.5 px-2 text-center text-gray-400">{g.p1_life}</td>
                  <td className="py-1.5 px-2 text-center text-gray-400">{g.p2_life}</td>
                  <td className="py-1.5 px-2 text-center text-gray-400">
                    {g.p1_damage_dealt}-{g.p2_damage_dealt}
                  </td>
                  <td className="py-1.5 px-2 text-center text-gray-400">
                    {g.p1_effects_fired}-{g.p2_effects_fired}
                  </td>
                  <td className="py-1.5 px-2 text-center text-gray-400">
                    {g.p1_mulligan && g.p2_mulligan
                      ? 'Both'
                      : g.p1_mulligan
                        ? 'P1'
                        : g.p2_mulligan
                          ? 'P2'
                          : '-'}
                  </td>
                  <td className="py-1.5 px-2 text-gray-400 capitalize">
                    {g.win_condition.replace(/_/g, ' ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}

interface SwapCandidate {
  card_id: string;
  name: string;
  image: string;
  power: number;
  cost: number;
  counter: number;
  synergy_score: number;
}

interface SwapInput {
  remove: string;
  remove_name?: string;
  remove_image?: string;
  role_needed?: string;
  reason: string;
  candidates?: SwapCandidate[];
}

function DeckHealthPanel({ health }: { health: DeckHealthAnalysis }) {
  const consistencyColor =
    health.consistency_rating === 'high'
      ? 'text-green-400 bg-green-900/20 border-green-900/40'
      : health.consistency_rating === 'medium'
        ? 'text-yellow-400 bg-yellow-900/20 border-yellow-900/40'
        : 'text-red-400 bg-red-900/20 border-red-900/40';

  return (
    <div className="bg-gray-900/80 rounded-lg p-4 space-y-4 mb-4">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-800/60 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-gray-200">{health.total_sims}</div>
          <div className="text-[10px] text-gray-500 uppercase">Simulations</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-gray-200">{health.total_games}</div>
          <div className="text-[10px] text-gray-500 uppercase">Total Games</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-3 text-center">
          <div className={`text-lg font-bold ${health.overall_win_rate > 0.6 ? 'text-green-400' : health.overall_win_rate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
            {(health.overall_win_rate * 100).toFixed(1)}%
          </div>
          <div className="text-[10px] text-gray-500 uppercase">Win Rate</div>
        </div>
        <div className={`rounded-lg p-3 text-center border ${consistencyColor}`}>
          <div className="text-lg font-bold capitalize">{health.consistency_rating}</div>
          <div className="text-[10px] uppercase opacity-70">Consistency</div>
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-300 leading-relaxed">{health.summary}</p>

      {/* Matchup spread */}
      {health.matchup_spread.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">
            Matchup Spread
          </h5>
          <div className="space-y-1.5">
            {health.matchup_spread.map((ms) => {
              const barColor = ms.win_rate > 0.6 ? 'bg-green-500' : ms.win_rate >= 0.4 ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <div key={ms.opponent} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-28 truncate shrink-0" title={ms.opponent}>{ms.opponent}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${ms.win_rate * 100}%` }} />
                  </div>
                  <span className={`w-12 text-right font-medium ${ms.win_rate > 0.6 ? 'text-green-400' : ms.win_rate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {(ms.win_rate * 100).toFixed(0)}%
                  </span>
                  <span className="text-gray-600 w-14 text-right">{ms.num_games}g</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Strengths */}
      {health.strengths.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-1.5">Strengths</h5>
          <ul className="space-y-1">
            {health.strengths.map((s, i) => (
              <li key={i} className="text-xs text-green-300/80 flex items-start gap-1.5">
                <span className="text-green-500 shrink-0 mt-0.5">+</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weaknesses */}
      {health.weaknesses.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1.5">Weaknesses</h5>
          <ul className="space-y-1">
            {health.weaknesses.map((w, i) => (
              <li key={i} className="text-xs text-yellow-300/80 flex items-start gap-1.5">
                <span className="text-yellow-500 shrink-0 mt-0.5">!</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Core Engine */}
      {health.core_engine.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">Core Engine Cards</h5>
          <div className="space-y-1.5">
            {health.core_engine.map((c) => (
              <div key={c.card_id} className="flex items-center gap-2 bg-emerald-900/15 border border-emerald-900/30 rounded-md px-3 py-2">
                <span className="text-xs font-medium text-emerald-300">{c.card_name || c.card_id}</span>
                <span className="text-[10px] text-gray-500">Play {(c.play_rate * 100).toFixed(0)}%</span>
                <span className="text-[10px] text-gray-500">Win {(c.win_correlation * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dead Cards */}
      {health.dead_cards.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1.5">Dead Cards</h5>
          <div className="space-y-1.5">
            {health.dead_cards.map((c) => (
              <div key={c.card_id} className="flex items-center gap-2 bg-red-900/15 border border-red-900/30 rounded-md px-3 py-2">
                <span className="text-xs font-medium text-red-300">{c.card_name || c.card_id}</span>
                <span className="text-[10px] text-gray-500">Play {(c.play_rate * 100).toFixed(0)}%</span>
                <span className="text-[10px] text-gray-500">Win {(c.win_correlation * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Synergy Insights */}
      {health.synergy_insights.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-1.5">Synergy Insights</h5>
          <ul className="space-y-1">
            {health.synergy_insights.map((s, i) => (
              <li key={i} className="text-xs text-purple-300/80 flex items-start gap-1.5">
                <span className="text-purple-500 shrink-0 mt-0.5">&bull;</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top Synergy Pairs */}
      {health.top_synergies.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1.5">Top Synergy Pairs</h5>
          <div className="grid grid-cols-2 gap-1.5">
            {health.top_synergies.map((sp, i) => (
              <div key={i} className="bg-cyan-900/15 border border-cyan-900/30 rounded-md px-3 py-2 text-xs">
                <span className="text-cyan-300">{sp.card_a}</span>
                <span className="text-gray-600 mx-1">+</span>
                <span className="text-cyan-300">{sp.card_b}</span>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Co-occur {(sp.co_occurrence_rate * 100).toFixed(0)}% | Lift {sp.win_lift.toFixed(2)}x
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role Gaps */}
      {health.role_gaps.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-1.5">Role Gaps</h5>
          <div className="flex flex-wrap gap-1.5">
            {health.role_gaps.map((role, i) => (
              <span key={i} className="bg-orange-900/20 border border-orange-900/40 text-orange-300 text-xs px-2.5 py-1 rounded-full capitalize">
                {role}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Improvement Priorities */}
      {health.improvement_priorities.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1.5">Improvement Priorities</h5>
          <ol className="space-y-1 list-decimal list-inside">
            {health.improvement_priorities.map((p, i) => (
              <li key={i} className="text-xs text-amber-300/80">{p}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SimHistoryTab({
  leaderId,
  cardIds,
  healthReport,
  onHealthReportChange,
}: {
  leaderId: string;
  cardIds: string[];
  healthReport: DeckHealthAnalysis | null;
  onHealthReportChange: (report: DeckHealthAnalysis | null) => void;
}) {
  const { data, loading, error, retry } = useFetch(
    () => getDeckSimHistory(leaderId, cardIds).then((r) => r.simulations),
    [leaderId, cardIds],
  );

  const [expandedSimId, setExpandedSimId] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [clearing, setClearing] = useState(false);

  const handleHealthReport = useCallback(() => {
    setHealthLoading(true);
    setHealthError(null);
    aggregateDeckAnalysis(leaderId, cardIds)
      .then(onHealthReportChange)
      .catch((e: Error) => setHealthError(e.message))
      .finally(() => setHealthLoading(false));
  }, [leaderId, cardIds, onHealthReportChange]);

  const handleClearHistory = useCallback(() => {
    if (!confirm('Clear all simulation history for this deck? This cannot be undone.')) return;
    setClearing(true);
    clearSimHistory(leaderId, cardIds)
      .then(() => {
        onHealthReportChange(null);
        retry();
      })
      .catch((e: Error) => alert(`Failed to clear: ${e.message}`))
      .finally(() => setClearing(false));
  }, [leaderId, cardIds, retry, onHealthReportChange]);

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
      {/* Deck Health Report */}
      {entries.length >= 2 && !healthReport && (
        <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700/40 rounded-lg px-4 py-3 mb-2">
          <div>
            <span className="text-xs font-medium text-gray-300">Deck Health Report</span>
            <span className="text-[10px] text-gray-500 ml-2">Aggregate analysis across {entries.length} simulations</span>
          </div>
          <button
            onClick={handleHealthReport}
            disabled={healthLoading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-4 py-1.5 rounded transition-colors"
          >
            {healthLoading ? 'Analyzing...' : 'Generate Report'}
          </button>
        </div>
      )}
      {healthError && (
        <div className="bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-2 text-xs text-red-400 mb-2">
          {healthError}
        </div>
      )}
      {healthReport && <DeckHealthPanel health={healthReport} />}

      {/* Header row + Clear button */}
      <div className="flex items-center justify-between px-3 py-1">
        <div className="grid grid-cols-6 gap-2 flex-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          <span>Opponent</span>
          <span className="text-center">Win Rate</span>
          <span className="text-center">Games</span>
          <span className="text-center">Avg Turns</span>
          <span className="text-center">Mode</span>
          <span className="text-right">Date</span>
        </div>
        <button
          onClick={handleClearHistory}
          disabled={clearing}
          className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50 px-2 py-1 rounded transition-colors shrink-0"
        >
          {clearing ? 'Clearing...' : 'Clear All'}
        </button>
      </div>

      {entries.map((entry) => {
        const winColor =
          entry.win_rate > 60
            ? 'text-green-400'
            : entry.win_rate >= 40
              ? 'text-yellow-400'
              : 'text-red-400';
        const isExpanded = expandedSimId === entry.sim_id;

        return (
          <div key={entry.sim_id}>
            <div
              onClick={() => setExpandedSimId(isExpanded ? null : entry.sim_id)}
              className={`grid grid-cols-6 gap-2 items-center rounded-lg px-3 py-2.5 text-xs cursor-pointer transition-colors ${
                isExpanded
                  ? 'bg-gray-700/60 border border-blue-500/40'
                  : 'bg-gray-800/50 border border-gray-700/40 hover:bg-gray-700/30'
              }`}
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
              <span className="text-right text-gray-500 flex items-center justify-end gap-1.5">
                {new Date(entry.timestamp).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                <svg
                  className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </div>

            {isExpanded && (
              <div className="mt-1.5 ml-2">
                <SimDetailPanel simId={entry.sim_id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Improve
// ---------------------------------------------------------------------------

function ImproveTab({ leaderId, cardIds, healthData, onHealthReportChange }: {
  leaderId: string;
  cardIds: string[];
  healthData?: DeckHealthAnalysis | null;
  onHealthReportChange?: (report: DeckHealthAnalysis | null) => void;
}) {
  const { data, loading, error, retry } = useFetch(
    () => improveDeck(leaderId, cardIds),
    [leaderId, cardIds],
  );

  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleGenerateReport = useCallback(() => {
    setReportLoading(true);
    setReportError(null);
    aggregateDeckAnalysis(leaderId, cardIds)
      .then((report) => onHealthReportChange?.(report))
      .catch((e: Error) => setReportError(e.message))
      .finally(() => setReportLoading(false));
  }, [leaderId, cardIds, onHealthReportChange]);

  const hasHealthInsights = healthData && (
    healthData.dead_cards.length > 0 ||
    healthData.role_gaps.length > 0 ||
    healthData.improvement_priorities.length > 0
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

  const totalIssues = (healthData?.dead_cards.length ?? 0) + (healthData?.role_gaps.length ?? 0) + data.improvements.length;

  return (
    <div className="space-y-5">
      {/* Hero section — AI Analysis CTA or Summary */}
      {!healthData ? (
        <div className="relative overflow-hidden rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-950/40 via-gray-900/60 to-gray-900/40 p-6">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-100">AI Simulation Analysis</h3>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Analyze game logs across all simulations to identify dead cards, missing roles, and prioritized improvements.
                </p>
              </div>
            </div>
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-wait text-white text-xs font-medium px-4 py-2.5 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
            >
              {reportLoading ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing game logs...
                </>
              ) : 'Generate AI Report'}
            </button>
            {reportError && (
              <p className="text-xs text-red-400 mt-2 text-center">{reportError}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-blue-500/15 bg-gradient-to-br from-blue-950/30 to-gray-900/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">AI Analysis Summary</h3>
            </div>
            {totalIssues > 0 && (
              <span className="text-[10px] font-medium text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded-full">
                {totalIssues} issue{totalIssues !== 1 ? 's' : ''} found
              </span>
            )}
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{healthData.summary}</p>
        </div>
      )}

      {/* Improvement Priorities */}
      {healthData && healthData.improvement_priorities.length > 0 && (
        <div className="rounded-xl border border-amber-500/15 bg-gray-900/40 p-4">
          <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Priority Actions
          </h4>
          <div className="space-y-2">
            {healthData.improvement_priorities.map((p, i) => (
              <div key={i} className="flex items-start gap-3 group">
                <span className="w-5 h-5 rounded-full bg-amber-900/30 border border-amber-700/30 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-gray-300 leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dead Cards + Role Gaps side by side */}
      {healthData && (healthData.dead_cards.length > 0 || healthData.role_gaps.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Dead Cards */}
          {healthData.dead_cards.length > 0 && (
            <div className="rounded-xl border border-red-500/15 bg-gray-900/40 p-4">
              <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                </svg>
                Remove — Dead Cards
              </h4>
              <div className="space-y-1.5">
                {healthData.dead_cards.map((c) => (
                  <div key={c.card_id} className="flex items-center justify-between rounded-lg bg-red-950/20 px-3 py-2 group hover:bg-red-950/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500/60" />
                      <span className="text-xs text-gray-200 font-medium">{c.card_name || c.card_id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded">{(c.play_rate * 100).toFixed(0)}% play</span>
                      <span className="text-[9px] text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded">{(c.win_correlation * 100).toFixed(0)}% win</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Role Gaps */}
          {healthData.role_gaps.length > 0 && (
            <div className="rounded-xl border border-emerald-500/15 bg-gray-900/40 p-4">
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add — Missing Roles
              </h4>
              <div className="space-y-1.5">
                {healthData.role_gaps.map((role, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-emerald-950/20 px-3 py-2.5 hover:bg-emerald-950/30 transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                    <span className="text-xs text-gray-200 font-medium capitalize">{role}</span>
                    <span className="text-[9px] text-emerald-500/60 ml-auto">needed</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rule-based swap suggestions */}
      {data.improvements.length > 0 && (
        <div className="rounded-xl border border-purple-500/15 bg-gray-900/40 p-4">
          <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Card Swaps
          </h4>
          <div className="space-y-2.5">
            {data.improvements.map((imp: DeckImprovement, i: number) => (
              <div key={i} className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full ${impactColor(imp.impact)}`}>
                    {imp.impact} impact
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {imp.remove && (
                    <div className="flex-1 rounded-md bg-red-950/20 border border-red-900/20 px-3 py-2">
                      <p className="text-[9px] font-semibold text-red-500/70 uppercase">Remove</p>
                      <p className="text-xs text-red-300 font-medium mt-0.5">{imp.remove.card_name}</p>
                      {imp.remove.reason && <p className="text-[10px] text-gray-500 mt-1">{imp.remove.reason}</p>}
                    </div>
                  )}
                  {imp.remove && imp.add && (
                    <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  )}
                  {imp.add && (
                    <div className="flex-1 rounded-md bg-emerald-950/20 border border-emerald-900/20 px-3 py-2">
                      <p className="text-[9px] font-semibold text-emerald-500/70 uppercase">Add</p>
                      <p className="text-xs text-emerald-300 font-medium mt-0.5">{imp.add.card_name}</p>
                      {imp.add.reason && <p className="text-[10px] text-gray-500 mt-1">{imp.add.reason}</p>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rule-based summary when no swaps — only show if we have health data (meaning sims were run) */}
      {data.improvements.length === 0 && data.summary && healthData && (
        <div className="rounded-xl border border-green-500/15 bg-gray-900/40 p-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-green-300">{data.summary}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {data.improvements.length === 0 && !hasHealthInsights && !data.summary && (
        <div className="text-center py-10">
          <div className="w-12 h-12 rounded-full bg-gray-800/60 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">No improvements needed</p>
          <p className="text-[10px] text-gray-600 mt-1">Your deck looks solid. Run simulations for deeper AI analysis.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: 'decklist', label: 'Deck List' },
  { id: 'deckmap', label: 'Deck Map' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'history', label: 'Sim History' },
  { id: 'improve', label: 'Improve' },
];

export default function DeckDetailPanel({
  deckId,
  leaderId,
  cardIds,
  deckName,
  onClose,
  onOpenBuilder,
  onSimulate,
  onDelete,
  onDeckChanged,
  isConfirmingDelete,
  isDeletingDeck,
  onCancelDelete,
  isActionLoading,
}: DeckDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('decklist');
  // Track which tabs have been visited so we lazy-mount them (avoids D3/SVG
  // measuring 0-size containers when hidden via display:none).
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(new Set(['decklist']));
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);
  const [swapModalData, setSwapModalData] = useState<{ swaps: SwapWithCandidates[] } | null>(null);
  const [healthReport, setHealthReport] = useState<DeckHealthAnalysis | null>(null);

  const handleApplySwaps = useCallback((swaps: SwapInput[]) => {
    const swapsWithCandidates: SwapWithCandidates[] = swaps
      .filter((s) => Array.isArray(s.candidates) && s.candidates.length > 0)
      .map((s) => ({
        remove: s.remove ?? '',
        remove_name: s.remove_name ?? s.remove ?? 'Unknown',
        remove_image: s.remove_image ?? '',
        role_needed: s.role_needed ?? '',
        reason: s.reason ?? '',
        candidates: (s.candidates ?? []).map((c) => ({
          ...c,
          power: c.power ?? 0,
          cost: c.cost ?? 0,
          counter: c.counter ?? 0,
          synergy_score: c.synergy_score ?? 0,
          image: c.image ?? '',
        })),
      }));
    if (swapsWithCandidates.length === 0) return;
    setSwapModalData({ swaps: swapsWithCandidates });
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-glass-border bg-surface-2">
        <h3 className="text-sm font-semibold text-text-primary truncate flex-1">{deckName}</h3>
        <div className="flex items-center gap-2 shrink-0">
          {onOpenBuilder && (
            <Button
              onClick={onOpenBuilder}
              variant="secondary"
              size="sm"
              disabled={isActionLoading}
            >
              {isActionLoading ? '...' : 'Load'}
            </Button>
          )}
          {onSimulate && (
            <Button
              onClick={onSimulate}
              variant="primary"
              size="sm"
              disabled={isActionLoading}
            >
              Simulate
            </Button>
          )}
          {onDelete && (
            isConfirmingDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  onClick={onDelete}
                  disabled={isDeletingDeck}
                  variant="danger"
                  size="sm"
                >
                  {isDeletingDeck ? '...' : 'Confirm'}
                </Button>
                <Button
                  onClick={onCancelDelete}
                  variant="ghost"
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                onClick={onDelete}
                variant="ghost"
                size="sm"
                className="text-text-muted hover:text-red-400"
              >
                Delete
              </Button>
            )
          )}
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors text-lg leading-none ml-1"
            aria-label="Close detail panel"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-glass-border px-4">
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

      {/* Tab content — fixed height container with internal scroll per tab.
           Lazy-mount on first visit, then keep mounted & hide via CSS. */}
      <div className="flex-1 overflow-hidden p-4">
        <div className={`h-full overflow-y-auto ${activeTab === 'decklist' ? '' : 'hidden'}`}>
          {mountedTabs.has('decklist') && <DeckListTab leaderId={leaderId} cardIds={cardIds} />}
        </div>
        <div className={`h-full overflow-y-auto ${activeTab === 'deckmap' ? '' : 'hidden'}`}>
          {mountedTabs.has('deckmap') && <DeckMapTab leaderId={leaderId} cardIds={cardIds} />}
        </div>
        <div className={`h-full overflow-y-auto ${activeTab === 'analysis' ? '' : 'hidden'}`}>
          {mountedTabs.has('analysis') && <AnalysisTab leaderId={leaderId} cardIds={cardIds} healthData={healthReport} onHealthReportChange={setHealthReport} />}
        </div>
        <div className={`h-full overflow-y-auto ${activeTab === 'history' ? '' : 'hidden'}`}>
          {mountedTabs.has('history') && (
            <SimHistoryTab
              leaderId={leaderId}
              cardIds={cardIds}
              healthReport={healthReport}
              onHealthReportChange={setHealthReport}
            />
          )}
        </div>
        <div className={`h-full overflow-y-auto ${activeTab === 'improve' ? '' : 'hidden'}`}>
          {mountedTabs.has('improve') && <ImproveTab leaderId={leaderId} cardIds={cardIds} healthData={healthReport} onHealthReportChange={setHealthReport} />}
        </div>
      </div>

      {/* Swap confirmation modal */}
      {swapModalData && (
        <SwapConfirmModal
          deckId={deckId}
          deckName={deckName}
          leaderId={leaderId}
          swaps={swapModalData.swaps}
          onClose={() => setSwapModalData(null)}
          onSaved={() => {
            setSwapModalData(null);
            onDeckChanged?.();
          }}
          onSimulate={onSimulate}
        />
      )}
    </div>
  );
}
