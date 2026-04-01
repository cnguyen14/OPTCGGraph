import { useState, useCallback, useRef } from 'react';
import type { SimulationProgress, SimulationResult } from '../types';
import { startBattle } from '../lib/api';

export interface GameProgressEntry {
  game: number;
  winner: string;
  turns: number;
  p1Life: number;
  p2Life: number;
  firstPlayer: string;
  winCondition: string;
  p1Mulligan: boolean;
  p2Mulligan: boolean;
  p1EffectsFired: number;
  p2EffectsFired: number;
  p1Damage: number;
  p2Damage: number;
  decisionCount: number;
  gameLog: Array<{
    turn: number;
    player: string;
    phase: string;
    action: string;
    details: Record<string, unknown>;
  }>;
}

interface SimulationState {
  status: 'idle' | 'loading' | 'running' | 'complete' | 'error';
  simId: string | null;
  progress: SimulationProgress;
  result: SimulationResult | null;
  error: string | null;
  p1Leader: string | null;
  p2Leader: string | null;
  gameResults: GameProgressEntry[];
  startedAt: number | null;
}

const INITIAL_PROGRESS: SimulationProgress = {
  completed: 0,
  total: 0,
  p1Wins: 0,
  p2Wins: 0,
  draws: 0,
};

export function useSimulation() {
  const [state, setState] = useState<SimulationState>({
    status: 'idle',
    simId: null,
    progress: INITIAL_PROGRESS,
    result: null,
    error: null,
    p1Leader: null,
    p2Leader: null,
    gameResults: [],
    startedAt: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const startSimulation = useCallback(
    async (
      deck1LeaderId: string,
      deck1CardIds: string[],
      deck2LeaderId: string,
      deck2CardIds: string[],
      numGames: number = 10,
      mode: string = 'virtual',
      p1Level: string = 'amateur',
      p2Level: string = 'medium',
      llmModel?: string,
    ) => {
      // Cleanup previous
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setState({
        status: 'loading',
        simId: null,
        progress: { ...INITIAL_PROGRESS, total: numGames },
        result: null,
        error: null,
        p1Leader: null,
        p2Leader: null,
        gameResults: [],
        startedAt: null,
      });

      try {
        const { sim_id } = await startBattle(
          deck1LeaderId,
          deck1CardIds,
          deck2LeaderId,
          deck2CardIds,
          numGames,
          mode,
          p1Level,
          p2Level,
          llmModel,
        );

        setState(prev => ({ ...prev, simId: sim_id }));

        // Connect SSE
        const es = new EventSource(`/api/simulator/status/${sim_id}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'loaded') {
              setState(prev => ({
                ...prev,
                status: 'running',
                p1Leader: data.p1_leader,
                p2Leader: data.p2_leader,
                startedAt: Date.now(),
              }));
            } else if (data.type === 'game_complete') {
              setState(prev => ({
                ...prev,
                progress: {
                  completed: data.game,
                  total: data.total,
                  p1Wins: data.p1_wins,
                  p2Wins: data.p2_wins,
                  draws: data.draws,
                },
                gameResults: [...prev.gameResults, {
                  game: data.game,
                  winner: data.winner,
                  turns: data.turns,
                  p1Life: data.p1_life ?? 0,
                  p2Life: data.p2_life ?? 0,
                  firstPlayer: data.first_player ?? 'p1',
                  winCondition: data.win_condition ?? 'unknown',
                  p1Mulligan: data.p1_mulligan ?? false,
                  p2Mulligan: data.p2_mulligan ?? false,
                  p1EffectsFired: data.p1_effects_fired ?? 0,
                  p2EffectsFired: data.p2_effects_fired ?? 0,
                  p1Damage: data.p1_damage ?? 0,
                  p2Damage: data.p2_damage ?? 0,
                  decisionCount: data.decision_count ?? 0,
                  gameLog: data.game_log ?? [],
                }],
              }));
            } else if (data.type === 'complete') {
              setState(prev => ({
                ...prev,
                status: 'complete',
                result: data.result,
              }));
              es.close();
            } else if (data.type === 'error') {
              setState(prev => ({
                ...prev,
                status: 'error',
                error: data.message,
              }));
              es.close();
            }
          } catch {
            // Ignore parse errors
          }
        };

        es.onerror = () => {
          setState(prev => ({
            ...prev,
            status: prev.status === 'complete' ? 'complete' : 'error',
            error: prev.status === 'complete' ? null : 'Connection lost',
          }));
          es.close();
        };
      } catch (err) {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to start simulation',
        }));
      }
    },
    [],
  );

  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setState({
      status: 'idle',
      simId: null,
      progress: INITIAL_PROGRESS,
      result: null,
      error: null,
      p1Leader: null,
      p2Leader: null,
      gameResults: [],
      startedAt: null,
    });
  }, []);

  return {
    ...state,
    startSimulation,
    reset,
  };
}
