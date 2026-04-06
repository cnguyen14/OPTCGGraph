import { useState, useEffect } from 'react';
import { checkApiBalance, fetchProviderModels } from '../../lib/api';
import type { SimulationHandle } from '../../hooks/useSimulation';
import type { ModelInfo } from '../../types';
import DeckSelector from './DeckSelector';
import type { SelectedDeck } from './DeckSelector';
import SimulationProgress from './SimulationProgress';
import LiveGameFeed from './LiveGameFeed';
import SimulatorDashboard from './SimulatorDashboard';
import { Button, Select, Input } from '../../components/ui';

interface Props {
  currentDeckLeaderId?: string;
  currentDeckCardIds?: string[];
  sim: SimulationHandle;
}

export default function SimulatorPage({ currentDeckLeaderId, currentDeckCardIds, sim }: Props) {
  const [deck1, setDeck1] = useState<SelectedDeck | null>(null);
  const [deck2, setDeck2] = useState<SelectedDeck | null>(null);
  const [mode, setMode] = useState<'virtual' | 'real'>('virtual');
  const [numGames, setNumGames] = useState(10);
  const [p1Level, setP1Level] = useState('amateur');
  const [p2Level, setP2Level] = useState('medium');
  const [provider, setProvider] = useState<'claude' | 'openrouter'>('claude');
  const [llmModel, setLlmModel] = useState('claude-haiku-4-5-20251001');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [concurrency, setConcurrency] = useState(10);
  const [hasBalance, setHasBalance] = useState<boolean | null>(null);

  // Check API balance when switching to Real mode (only for Claude provider)
  useEffect(() => {
    if (mode === 'real' && provider === 'claude') {
      checkApiBalance()
        .then((r) => setHasBalance(r.has_balance))
        .catch(() => setHasBalance(false));
    } else if (provider === 'openrouter') {
      setHasBalance(null); // Don't show balance warning for OpenRouter
    }
  }, [mode, provider]);

  // Load models when provider changes
  useEffect(() => {
    if (mode !== 'real') return;
    setModelsLoading(true);
    fetchProviderModels(provider)
      .then((r) => {
        if (r.status === 'ok' && r.models.length > 0) {
          setAvailableModels(r.models);
          setLlmModel(r.models[0].id);
        } else {
          setAvailableModels([]);
        }
      })
      .catch(() => setAvailableModels([]))
      .finally(() => setModelsLoading(false));
  }, [provider, mode]);

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
      mode === 'real' ? concurrency : undefined,
    );
  };

  return (
    <div className="h-full flex gap-3 p-3 overflow-hidden">
      {/* Left Sidebar — Settings & Controls */}
      <div className="glass w-56 shrink-0 overflow-y-auto p-4 space-y-4 flex flex-col">
        {/* Mode */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Mode</label>
          <div className="flex gap-0.5">
            <Button
              variant={mode === 'virtual' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMode('virtual')}
              disabled={!isIdle}
              className="flex-1 !rounded-r-none"
            >
              Virtual
            </Button>
            <Button
              variant={mode === 'real' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMode('real')}
              disabled={!isIdle}
              className="flex-1 !rounded-l-none"
            >
              Real (AI)
            </Button>
          </div>
          <p className="text-[9px] text-text-muted mt-1">
            {mode === 'virtual' ? 'Free, rule-based' : 'LLM-powered, costs credits'}
          </p>
        </div>

        {/* Settings */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Settings</label>
          <div className="space-y-2">
            <Input
              type="number"
              min={1}
              max={200}
              value={numGames}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= 200) setNumGames(v);
              }}
              className="w-full text-center text-xs"
              disabled={!isIdle}
              label="Games (1-200)"
            />
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
            {mode === 'real' && (
              <>
                <Select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as 'claude' | 'openrouter')}
                  disabled={!isIdle}
                  label="Provider"
                  className="text-xs"
                >
                  <option value="claude">Anthropic (Direct)</option>
                  <option value="openrouter">OpenRouter</option>
                </Select>
                <Select
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  disabled={!isIdle || modelsLoading}
                  label="Model"
                  className="text-xs"
                >
                  {modelsLoading ? (
                    <option>Loading models...</option>
                  ) : availableModels.length > 0 ? (
                    availableModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))
                  ) : (
                    <option>No models available</option>
                  )}
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={concurrency}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= 50) setConcurrency(v);
                  }}
                  className="w-full text-center text-xs"
                  disabled={!isIdle}
                  label="Parallel Games (1-50)"
                />
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 mt-auto">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block">Actions</label>
          {isIdle ? (
            <Button
              onClick={handleStart}
              disabled={!canStart}
              variant="primary"
              size="sm"
              className="w-full"
            >
              {sim.status === 'complete' ? 'Run Again' : 'Start Battle'}
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-op-ocean">
              <svg viewBox="0 0 24 24" className="w-4 h-4 animate-[wheel-spin_3s_linear_infinite] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="2" />
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                  <line
                    key={angle}
                    x1={12 + 2.5 * Math.cos((angle * Math.PI) / 180)}
                    y1={12 + 2.5 * Math.sin((angle * Math.PI) / 180)}
                    x2={12 + 8.5 * Math.cos((angle * Math.PI) / 180)}
                    y2={12 + 8.5 * Math.sin((angle * Math.PI) / 180)}
                  />
                ))}
              </svg>
              <span className="truncate">
                {sim.status === 'loading'
                  ? 'Loading...'
                  : sim.progress.completed === 0
                    ? (mode === 'real' ? `Running ${Math.min(concurrency, numGames)} games...` : 'Starting...')
                    : `${sim.progress.completed}/${sim.progress.total} done`}
              </span>
            </div>
          )}
          {sim.status === 'complete' && (
            <Button onClick={sim.reset} variant="ghost" size="sm" className="w-full">
              Reset
            </Button>
          )}
          {sim.error && (
            <p className="text-[10px] text-red-400 mt-1">{sim.error}</p>
          )}
          {mode === 'real' && hasBalance === false && (
            <p className="text-[10px] text-red-400 mt-1">
              No API balance.{' '}
              <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="underline text-red-300 hover:text-red-200">
                Add credits
              </a>
            </p>
          )}
        </div>
      </div>

      {/* Center — Battle Arena */}
      <div className="flex-1 glass overflow-hidden min-w-0 flex flex-col">
        <div className="shrink-0 px-4 py-2.5 border-b border-glass-border/50">
          <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider">Battle Arena</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sim.status === 'idle' && (
            <div className="flex-1 flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <p className="text-lg">Ready to battle</p>
                <p className="text-sm mt-1">Select decks and configure settings, then start a battle</p>
              </div>
            </div>
          )}

          {(sim.status === 'running' || sim.status === 'loading') && (
            <div className="p-4 space-y-4">
              <SimulationProgress
                progress={sim.progress}
                p1Leader={sim.p1Leader}
                p2Leader={sim.p2Leader}
                startedAt={sim.startedAt}
                parallelGames={mode === 'real' ? Math.min(concurrency, numGames) : undefined}
              />
              <LiveGameFeed
                gameResults={sim.gameResults}
                p1Leader={sim.p1Leader}
                p2Leader={sim.p2Leader}
                totalGames={sim.progress.total}
                isRunning={sim.status === 'running'}
                parallelGames={mode === 'real' ? Math.min(concurrency, numGames) : undefined}
              />
            </div>
          )}

          {sim.status === 'error' && (
            <div className="flex-1 flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <p className="text-lg text-red-400">Simulation failed</p>
                <p className="text-sm mt-1 text-red-400/70">{sim.error}</p>
              </div>
            </div>
          )}

          {sim.status === 'complete' && sim.result && (
            <div className="p-4">
              <SimulatorDashboard
                result={sim.result}
                gameResults={sim.gameResults}
                simId={sim.simId}
                p1Leader={sim.p1Leader}
                p2Leader={sim.p2Leader}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right Panel — Deck Selection & Battle Info */}
      <div className="glass w-[380px] shrink-0 overflow-y-auto p-4 space-y-4 flex flex-col">
        {/* Your Deck */}
        <DeckSelector
          label="Your Deck"
          currentDeckLeaderId={currentDeckLeaderId}
          currentDeckCardIds={currentDeckCardIds}
          onSelect={setDeck1}
          selected={deck1}
          bare
        />

        <div className="border-t border-glass-border/50" />

        {/* Opponent Deck */}
        <DeckSelector
          label="Opponent Deck"
          onSelect={setDeck2}
          selected={deck2}
          bare
        />

        {/* Battle Status */}
        {(sim.status === 'running' || sim.status === 'complete') && sim.progress.total > 0 && (
          <>
            <div className="border-t border-glass-border/50" />
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">Battle Score</label>
              <div className="grid grid-cols-3 gap-2">
                <div className="glass-subtle p-2 rounded-lg text-center">
                  <p className="text-base font-bold text-blue-400">{sim.progress.p1Wins}</p>
                  <p className="text-[9px] text-text-muted uppercase">P1 Wins</p>
                </div>
                <div className="glass-subtle p-2 rounded-lg text-center">
                  <p className="text-base font-bold text-text-muted">{sim.progress.draws}</p>
                  <p className="text-[9px] text-text-muted uppercase">Draws</p>
                </div>
                <div className="glass-subtle p-2 rounded-lg text-center">
                  <p className="text-base font-bold text-red-400">{sim.progress.p2Wins}</p>
                  <p className="text-[9px] text-text-muted uppercase">P2 Wins</p>
                </div>
              </div>
              {sim.progress.completed > 0 && (
                <div className="mt-2 h-2 bg-surface-2 rounded-full overflow-hidden flex">
                  <div
                    className="bg-blue-500 transition-all"
                    style={{ width: `${(sim.progress.p1Wins / sim.progress.completed) * 100}%` }}
                  />
                  <div
                    className="bg-gray-500 transition-all"
                    style={{ width: `${(sim.progress.draws / sim.progress.completed) * 100}%` }}
                  />
                  <div
                    className="bg-red-500 transition-all"
                    style={{ width: `${(sim.progress.p2Wins / sim.progress.completed) * 100}%` }}
                  />
                </div>
              )}
              <p className="text-[10px] text-text-muted text-center mt-1.5">
                {sim.progress.completed} / {sim.progress.total} games
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
