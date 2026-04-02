import { useState, useEffect } from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { checkApiBalance } from '../../lib/api';
import DeckSelector from './DeckSelector';
import type { SelectedDeck } from './DeckSelector';
import SimulationProgress from './SimulationProgress';
import LiveGameFeed from './LiveGameFeed';
import SimulatorDashboard from './SimulatorDashboard';
import { GlassCard, Button, Select, Input, Spinner } from '../../components/ui';

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
          <h2 className="text-xl font-bold text-text-primary">Battle Simulator</h2>
          <p className="text-sm text-text-secondary mt-1">
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
            <div className="flex bg-surface-2 rounded-lg p-0.5">
              <button
                onClick={() => setMode('virtual')}
                disabled={!isIdle}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'virtual'
                    ? 'glass text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Virtual (Free)
              </button>
              <button
                onClick={() => setMode('real')}
                disabled={!isIdle}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'real'
                    ? 'bg-op-ocean text-white shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Real (AI)
              </button>
            </div>
            <span className="text-[10px] text-text-muted">
              {mode === 'virtual'
                ? 'Fast rule-based simulation. Free, instant results.'
                : 'LLM-powered AI agents. More realistic, costs API credits.'}
            </span>
            {mode === 'real' && hasBalance === false && (
              <GlassCard variant="subtle" className="mt-1 px-3 py-1.5 text-xs text-red-400 border-red-700/40">
                Insufficient Claude API balance. Please{' '}
                <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="underline text-red-300 hover:text-red-200">
                  add credits
                </a>{' '}
                or switch to Virtual (Free) mode.
              </GlassCard>
            )}
          </div>

          {/* Controls Row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={200}
                value={numGames}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= 200) setNumGames(v);
                }}
                className="!w-16 text-center text-xs"
                disabled={!isIdle}
                label="Games"
              />
              <span className="text-[10px] text-text-muted mt-5">1-200</span>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={p1Level}
                onChange={(e) => setP1Level(e.target.value)}
                disabled={!isIdle}
                label="Your Playstyle"
                className="text-xs"
              >
                <option value="new">New Player</option>
                <option value="amateur">Amateur</option>
                <option value="pro">Professional</option>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={p2Level}
                onChange={(e) => setP2Level(e.target.value)}
                disabled={!isIdle}
                label="Bot Difficulty"
                className="text-xs"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </div>

            {mode === 'real' && (
              <div className="flex items-center gap-2">
                <Select
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  disabled={!isIdle}
                  label="Model"
                  className="text-xs"
                >
                  <option value="claude-haiku-4-5-20251001">Haiku 4.5 (fast, cheap)</option>
                  <option value="claude-sonnet-4-6">Sonnet 4.6 (balanced)</option>
                  <option value="claude-opus-4-6">Opus 4.6 (smartest, slow)</option>
                </Select>
              </div>
            )}

            <div className="flex-1" />

            {isIdle ? (
              <Button
                onClick={handleStart}
                disabled={!canStart}
                variant="primary"
                size="md"
              >
                {sim.status === 'complete' ? 'Run Again' : 'Start Battle'}
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-op-ocean">
                <Spinner size="sm" />
                {sim.status === 'loading'
                  ? 'Loading decks...'
                  : sim.progress.completed === 0
                    ? 'Starting first game...'
                    : `Game ${sim.progress.completed + 1} of ${sim.progress.total} in progress...`}
              </div>
            )}

            {sim.status === 'complete' && (
              <Button onClick={sim.reset} variant="ghost" size="sm">
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Error */}
        {sim.error && (
          <GlassCard variant="subtle" className="p-3 text-xs text-red-400 border-red-700/40">
            {sim.error}
          </GlassCard>
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
