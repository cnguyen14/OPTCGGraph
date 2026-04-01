import { useState, useEffect } from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { checkApiBalance } from '../../lib/api';
import DeckSelector from './DeckSelector';
import type { SelectedDeck } from './DeckSelector';
import SimulationProgress from './SimulationProgress';
import LiveGameFeed from './LiveGameFeed';
import SimulatorDashboard from './SimulatorDashboard';

interface Props {
  currentDeckLeaderId?: string;
  currentDeckCardIds?: string[];
}

export default function SimulatorPage({ currentDeckLeaderId, currentDeckCardIds }: Props) {
  const [deck1, setDeck1] = useState<SelectedDeck | null>(null);
  const [deck2, setDeck2] = useState<SelectedDeck | null>(null);
  const [mode, setMode] = useState<'virtual' | 'real'>('virtual');
  const [numGames, setNumGames] = useState(10);
  const [p1Level, setP1Level] = useState('amateur');
  const [p2Level, setP2Level] = useState('medium');
  const [llmModel, setLlmModel] = useState('claude-haiku-4-5-20251001');
  const [hasBalance, setHasBalance] = useState<boolean | null>(null);

  const sim = useSimulation();

  // Check API balance when switching to Real mode
  useEffect(() => {
    if (mode === 'real') {
      checkApiBalance()
        .then((r) => setHasBalance(r.has_balance))
        .catch(() => setHasBalance(false));
    }
  }, [mode]);

  const canStart = deck1 && deck2 && deck1.cardIds.length === 50 && deck2.cardIds.length === 50
    && !(mode === 'real' && hasBalance === false);
  const isIdle = sim.status === 'idle' || sim.status === 'error' || sim.status === 'complete';

  const handleStart = () => {
    if (!deck1 || !deck2) return;
    sim.startSimulation(
      deck1.leaderId,
      deck1.cardIds,
      deck2.leaderId,
      deck2.cardIds,
      numGames,
      mode,
      p1Level,
      p2Level,
      mode === 'real' ? llmModel : undefined,
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white">Battle Simulator</h2>
          <p className="text-sm text-gray-400 mt-1">
            Test your deck against tournament decks. AI agents play real OPTCG games to find strengths and weaknesses.
          </p>
        </div>

        {/* Deck Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DeckSelector
            label="Your Deck"
            currentDeckLeaderId={currentDeckLeaderId}
            currentDeckCardIds={currentDeckCardIds}
            onSelect={setDeck1}
            selected={deck1}
          />
          <DeckSelector
            label="Opponent Deck"
            onSelect={setDeck2}
            selected={deck2}
          />
        </div>

        {/* Mode Tabs + Controls */}
        <div className="space-y-4">
          {/* Mode Tabs */}
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-800/80 rounded-lg p-0.5">
              <button
                onClick={() => setMode('virtual')}
                disabled={!isIdle}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'virtual'
                    ? 'bg-gray-700 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Virtual (Free)
              </button>
              <button
                onClick={() => setMode('real')}
                disabled={!isIdle}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'real'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Real (AI)
              </button>
            </div>
            <span className="text-[10px] text-gray-500">
              {mode === 'virtual'
                ? 'Fast rule-based simulation. Free, instant results.'
                : 'LLM-powered AI agents. More realistic, costs API credits.'}
            </span>
            {mode === 'real' && hasBalance === false && (
              <div className="mt-1 px-3 py-1.5 rounded-md bg-red-900/30 border border-red-700/40 text-xs text-red-400">
                Insufficient Claude API balance. Please{' '}
                <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="underline text-red-300 hover:text-red-200">
                  add credits
                </a>{' '}
                or switch to Virtual (Free) mode.
              </div>
            )}
          </div>

          {/* Controls Row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Games:</label>
              <input
                type="number"
                min={1}
                max={200}
                value={numGames}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= 200) setNumGames(v);
                }}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white w-16 text-center"
                disabled={!isIdle}
              />
              <span className="text-[10px] text-gray-500">1-200</span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Your Playstyle:</label>
              <select
                value={p1Level}
                onChange={(e) => setP1Level(e.target.value)}
                disabled={!isIdle}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
              >
                <option value="new">New Player</option>
                <option value="amateur">Amateur</option>
                <option value="pro">Professional</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Bot Difficulty:</label>
              <select
                value={p2Level}
                onChange={(e) => setP2Level(e.target.value)}
                disabled={!isIdle}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            {mode === 'real' && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Model:</label>
                <select
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  disabled={!isIdle}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                >
                  <option value="claude-haiku-4-5-20251001">Haiku 4.5 (fast, cheap)</option>
                  <option value="claude-sonnet-4-6">Sonnet 4.6 (balanced)</option>
                  <option value="claude-opus-4-6">Opus 4.6 (smartest, slow)</option>
                </select>
              </div>
            )}

            <div className="flex-1" />

            {isIdle ? (
              <button
                onClick={handleStart}
                disabled={!canStart}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {sim.status === 'complete' ? 'Run Again' : 'Start Battle'}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                {sim.status === 'loading'
                  ? 'Loading decks...'
                  : sim.progress.completed === 0
                    ? 'Starting first game...'
                    : `Game ${sim.progress.completed + 1} of ${sim.progress.total} in progress...`}
              </div>
            )}

            {sim.status === 'complete' && (
              <button
                onClick={sim.reset}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {sim.error && (
          <div className="rounded-lg bg-red-950/30 border border-red-700/40 p-3 text-xs text-red-400">
            {sim.error}
          </div>
        )}

        {/* Progress */}
        {(sim.status === 'running' || sim.status === 'loading') && (
          <>
            <SimulationProgress
              progress={sim.progress}
              p1Leader={sim.p1Leader}
              p2Leader={sim.p2Leader}
              startedAt={sim.startedAt}
            />
            <LiveGameFeed
              gameResults={sim.gameResults}
              p1Leader={sim.p1Leader}
              p2Leader={sim.p2Leader}
              totalGames={sim.progress.total}
              isRunning={sim.status === 'running'}
            />
          </>
        )}

        {/* Results */}
        {sim.status === 'complete' && sim.result && (
          <SimulatorDashboard
            result={sim.result}
            gameResults={sim.gameResults}
            simId={sim.simId}
            p1Leader={sim.p1Leader}
            p2Leader={sim.p2Leader}
          />
        )}
      </div>
    </div>
  );
}
