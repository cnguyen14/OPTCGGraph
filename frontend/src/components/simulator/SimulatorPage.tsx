import { useState } from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import DeckSelector from './DeckSelector';
import type { SelectedDeck } from './DeckSelector';
import SimulationProgress from './SimulationProgress';
import LiveGameFeed from './LiveGameFeed';
import ResultsDashboard from './ResultsDashboard';

interface Props {
  currentDeckLeaderId?: string;
  currentDeckCardIds?: string[];
}

export default function SimulatorPage({ currentDeckLeaderId, currentDeckCardIds }: Props) {
  const [deck1, setDeck1] = useState<SelectedDeck | null>(null);
  const [deck2, setDeck2] = useState<SelectedDeck | null>(null);
  const [numGames, setNumGames] = useState(10);
  const [agentType, setAgentType] = useState('heuristic');
  const [llmModel, setLlmModel] = useState('claude-haiku-4-5-20251001');

  const sim = useSimulation();

  const canStart = deck1 && deck2 && deck1.cardIds.length === 50 && deck2.cardIds.length === 50;

  const handleStart = () => {
    if (!deck1 || !deck2) return;
    sim.startSimulation(
      deck1.leaderId,
      deck1.cardIds,
      deck2.leaderId,
      deck2.cardIds,
      numGames,
      agentType,
      agentType === 'llm' ? llmModel : undefined,
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

        {/* Controls */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Games:</label>
            <select
              value={numGames}
              onChange={(e) => setNumGames(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
              disabled={sim.status === 'running'}
            >
              {[5, 10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Opponent AI:</label>
            <select
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
              disabled={sim.status === 'running'}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
            >
              <option value="heuristic">Heuristic (fast, basic)</option>
              <option value="stress_realistic">Stress Test (smart, realistic)</option>
              <option value="stress_godmode">Stress Test — God Mode (sees your hand)</option>
              <option value="llm">AI Agent (LLM)</option>
            </select>
          </div>

          {agentType === 'llm' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400">Model:</label>
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                disabled={sim.status === 'running'}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
              >
                <option value="claude-haiku-4-5-20251001">Haiku 4.5 (fast, cheap)</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6 (balanced)</option>
                <option value="claude-opus-4-6">Opus 4.6 (smartest, slow)</option>
              </select>
            </div>
          )}

          <div className="flex-1" />

          {sim.status === 'idle' || sim.status === 'error' || sim.status === 'complete' ? (
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
          <>
            <ResultsDashboard result={sim.result} />
            <LiveGameFeed
              gameResults={sim.gameResults}
              p1Leader={sim.p1Leader}
              p2Leader={sim.p2Leader}
              totalGames={sim.progress.total}
              isRunning={false}
            />
          </>
        )}
      </div>
    </div>
  );
}
