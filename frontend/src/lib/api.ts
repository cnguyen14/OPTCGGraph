import type {
  CardSearchParams,
  CardSearchResponse,
  Facets,
  SystemStatus,
  CrawlStatus,
  BannedCard,
  ModelsResponse,
  TestKeyResult,
  ProviderModelsResult,
} from '../types';

const BASE_URL = '/api';

export async function fetchCard(cardId: string) {
  const resp = await fetch(`${BASE_URL}/graph/card/${cardId}`);
  if (!resp.ok) throw new Error(`Card ${cardId} not found`);
  return resp.json();
}

export async function fetchSynergies(cardId: string, maxHops = 1, color?: string) {
  const params = new URLSearchParams({ max_hops: String(maxHops) });
  if (color) params.set('color', color);
  const resp = await fetch(`${BASE_URL}/graph/card/${cardId}/synergies?${params}`);
  return resp.json();
}

export async function fetchDeckCandidates(leaderId: string, limit = 50) {
  const resp = await fetch(`${BASE_URL}/graph/leader/${leaderId}/deck-candidates?limit=${limit}`);
  return resp.json();
}

export async function searchCards(params: CardSearchParams): Promise<CardSearchResponse> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.color) query.set('color', params.color);
  if (params.card_type) query.set('card_type', params.card_type);
  if (params.family) query.set('family', params.family);
  if (params.set_name) query.set('set_name', params.set_name);
  if (params.rarity) query.set('rarity', params.rarity);
  if (params.cost_min !== undefined) query.set('cost_min', String(params.cost_min));
  if (params.cost_max !== undefined) query.set('cost_max', String(params.cost_max));
  if (params.sort_by) query.set('sort_by', params.sort_by);
  if (params.sort_order) query.set('sort_order', params.sort_order);
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  const resp = await fetch(`${BASE_URL}/graph/search?${query}`);
  return resp.json();
}

export async function fetchFacets(): Promise<Facets> {
  const resp = await fetch(`${BASE_URL}/graph/facets`);
  return resp.json();
}

export async function fetchStats() {
  const resp = await fetch(`${BASE_URL}/graph/stats`);
  return resp.json();
}

export async function fetchHubs(top = 10, color?: string) {
  const params = new URLSearchParams({ top: String(top) });
  if (color) params.set('color', color);
  const resp = await fetch(`${BASE_URL}/graph/stats/hubs?${params}`);
  return resp.json();
}

export async function fetchCurve(color?: string, family?: string) {
  const params = new URLSearchParams();
  if (color) params.set('color', color);
  if (family) params.set('family', family);
  const resp = await fetch(`${BASE_URL}/graph/query/curve?${params}`);
  return resp.json();
}

export interface DeckSynergyEdge {
  source: string;
  target: string;
  type: string;
  weight: number | null;
  shared_families?: string[];
  shared_keywords?: string[];
  cost_diff?: number;
}

export interface DeckSynergyResponse {
  edges: DeckSynergyEdge[];
}

export async function fetchDeckSynergies(cardIds: string[]): Promise<DeckSynergyResponse> {
  const resp = await fetch(`${BASE_URL}/graph/deck/synergies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_ids: cardIds }),
  });
  return resp.json();
}

export async function validateDeck(leaderId: string, cardIds: string[]) {
  const resp = await fetch(`${BASE_URL}/deck/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function suggestFixes(leaderId: string, cardIds: string[]) {
  const resp = await fetch(`${BASE_URL}/deck/suggest-fixes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function chatSync(
  message: string,
  sessionId?: string,
  leaderId?: string,
  deckCardIds?: string[],
) {
  const resp = await fetch(`${BASE_URL}/ai/chat/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      leader_id: leaderId,
      deck_card_ids: deckCardIds,
    }),
  });
  return resp.json();
}

// --- Chat session history ---

export interface SessionSummary {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface SessionDetail {
  session_id: string;
  title: string;
  messages: { role: string; content: string }[];
  created_at: string;
  updated_at: string;
}

export async function fetchChatSessions(clientId: string): Promise<SessionSummary[]> {
  const resp = await fetch(`${BASE_URL}/ai/sessions?client_id=${encodeURIComponent(clientId)}`);
  const data = await resp.json();
  return data.sessions ?? [];
}

export async function loadChatSession(sessionId: string): Promise<SessionDetail | null> {
  const resp = await fetch(`${BASE_URL}/ai/sessions/${sessionId}`);
  const data = await resp.json();
  if (data.error) return null;
  return data;
}

export async function deleteChatSession(sessionId: string, clientId: string): Promise<void> {
  await fetch(`${BASE_URL}/ai/sessions/${sessionId}?client_id=${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
  });
}

export async function fetchModels(): Promise<ModelsResponse> {
  const resp = await fetch(`${BASE_URL}/settings/models`);
  return resp.json();
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const resp = await fetch(`${BASE_URL}/settings/status`);
  return resp.json();
}

export async function checkApiBalance(): Promise<{ has_balance: boolean; status: string; message: string }> {
  const resp = await fetch(`${BASE_URL}/settings/balance`);
  return resp.json();
}

export async function fetchHealth(): Promise<{ status: string; neo4j: boolean; redis: boolean }> {
  const resp = await fetch('/health');
  return resp.json();
}

export async function switchModel(provider: string, model: string) {
  const resp = await fetch(`${BASE_URL}/settings/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model }),
  });
  return resp.json();
}

// === Meta / Tournament API ===

import type {
  Tournament,
  MetaDeckSummary,
  MetaDeckDetail,
  MetaOverview,
  SwapSuggestion,
  SimulationResult,
  SavedDeck,
  SavedDeckListItem,
} from '../types';

export async function fetchTournaments(limit = 50): Promise<Tournament[]> {
  const resp = await fetch(`${BASE_URL}/meta/tournaments?limit=${limit}`);
  return resp.json();
}

export interface MetaDeckFilters {
  leader?: string;
  archetype?: string;
  tournament_id?: string;
  max_placement?: number;
  limit?: number;
  offset?: number;
}

export async function fetchMetaDecks(filters: MetaDeckFilters = {}): Promise<MetaDeckSummary[]> {
  const params = new URLSearchParams();
  if (filters.leader) params.set('leader', filters.leader);
  if (filters.archetype) params.set('archetype', filters.archetype);
  if (filters.tournament_id) params.set('tournament_id', filters.tournament_id);
  if (filters.max_placement) params.set('max_placement', String(filters.max_placement));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const resp = await fetch(`${BASE_URL}/meta/decks?${params}`);
  return resp.json();
}

export async function fetchMetaDeckDetail(deckId: string): Promise<MetaDeckDetail> {
  const resp = await fetch(`${BASE_URL}/meta/decks/${deckId}`);
  return resp.json();
}

export async function fetchMetaOverview(): Promise<MetaOverview> {
  const resp = await fetch(`${BASE_URL}/meta/overview`);
  return resp.json();
}

export async function suggestSwap(
  deckCardIds: string[],
  incomingCardId: string,
  leaderId?: string,
): Promise<SwapSuggestion | null> {
  const resp = await fetch(`${BASE_URL}/meta/suggest-swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck_card_ids: deckCardIds,
      incoming_card_id: incomingCardId,
      leader_id: leaderId,
    }),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// === Simulator API ===

export async function startBattle(
  deck1LeaderId: string,
  deck1CardIds: string[],
  deck2LeaderId: string,
  deck2CardIds: string[],
  numGames: number = 10,
  mode: string = 'virtual',
  p1Level: string = 'amateur',
  p2Level: string = 'medium',
  llmModel?: string,
  concurrency?: number,
): Promise<{ sim_id: string }> {
  const resp = await fetch(`${BASE_URL}/simulator/battle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck1_leader_id: deck1LeaderId,
      deck1_card_ids: deck1CardIds,
      deck2_leader_id: deck2LeaderId,
      deck2_card_ids: deck2CardIds,
      num_games: numGames,
      mode,
      p1_level: p1Level,
      p2_level: p2Level,
      ...(llmModel ? { llm_model: llmModel } : {}),
      ...(concurrency ? { concurrency } : {}),
    }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function fetchSimulationResult(simId: string): Promise<SimulationResult> {
  const resp = await fetch(`${BASE_URL}/simulator/result/${simId}`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

// === Saved Decks API ===

const CLIENT_ID_KEY = 'optcg-client-id';

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function clientHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Client-Id': getClientId(),
  };
}

export async function saveDeck(req: {
  name: string;
  description?: string;
  leader_id: string | null;
  entries: { card_id: string; quantity: number }[];
  deck_notes?: string;
}): Promise<SavedDeck> {
  const resp = await fetch(`${BASE_URL}/deck/saved`, {
    method: 'POST',
    headers: clientHeaders(),
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function updateDeck(
  id: string,
  req: {
    name: string;
    description?: string;
    leader_id: string | null;
    entries: { card_id: string; quantity: number }[];
    deck_notes?: string;
  },
): Promise<SavedDeck> {
  const resp = await fetch(`${BASE_URL}/deck/saved?id=${id}`, {
    method: 'POST',
    headers: clientHeaders(),
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function listSavedDecks(): Promise<SavedDeckListItem[]> {
  const resp = await fetch(`${BASE_URL}/deck/saved`, {
    headers: { 'X-Client-Id': getClientId() },
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function loadSavedDeck(id: string): Promise<SavedDeck> {
  const resp = await fetch(`${BASE_URL}/deck/saved/${id}`, {
    headers: { 'X-Client-Id': getClientId() },
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function deleteSavedDeck(id: string): Promise<void> {
  const resp = await fetch(`${BASE_URL}/deck/saved/${id}`, {
    method: 'DELETE',
    headers: { 'X-Client-Id': getClientId() },
  });
  if (!resp.ok) throw new Error(await resp.text());
}

// === Dashboard / Settings API ===

export async function fetchCrawlStatus(): Promise<CrawlStatus> {
  const resp = await fetch(`${BASE_URL}/data/crawl-status`);
  return resp.json();
}

export async function triggerRebuild(): Promise<{ status: string }> {
  const resp = await fetch(`${BASE_URL}/data/rebuild`, { method: 'POST' });
  return resp.json();
}

export async function fetchRebuildStatus(): Promise<{ status: string; last_run: string | null }> {
  const resp = await fetch(`${BASE_URL}/data/rebuild-status`);
  return resp.json();
}

export async function stopRebuild(): Promise<{ status: string }> {
  const resp = await fetch(`${BASE_URL}/data/rebuild-stop`, { method: 'POST' });
  return resp.json();
}

export async function fetchBannedCards(): Promise<BannedCard[]> {
  const resp = await fetch(`${BASE_URL}/data/banned-cards`);
  return resp.json();
}

// === BYOK (Bring Your Own Key) API ===

export async function saveApiKey(provider: string, apiKey: string): Promise<{ status: string }> {
  const resp = await fetch(`${BASE_URL}/settings/api-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  return resp.json();
}

export async function removeApiKey(provider: string): Promise<{ status: string }> {
  const resp = await fetch(`${BASE_URL}/settings/api-key/${provider}`, { method: 'DELETE' });
  return resp.json();
}

export async function testApiKey(provider: string, apiKey: string): Promise<TestKeyResult> {
  const resp = await fetch(`${BASE_URL}/settings/test-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  return resp.json();
}

// === Deck Analysis / Improve API ===

import type { DeckAnalysis, SimHistoryEntry, DeckImprovements, SimDetail, MatchupAnalysis, SimAnalyticsResponse, DeckHealthAnalysis } from '../types';

export async function analyzeDeck(
  leaderId: string,
  cardIds: string[],
): Promise<DeckAnalysis> {
  const resp = await fetch(`${BASE_URL}/deck/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function getDeckSimHistory(
  leaderId: string,
  cardIds: string[],
): Promise<{ simulations: SimHistoryEntry[] }> {
  const resp = await fetch(`${BASE_URL}/deck/sim-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function improveDeck(
  leaderId: string,
  cardIds: string[],
  simCardStats?: Record<string, unknown>,
): Promise<DeckImprovements> {
  const resp = await fetch(`${BASE_URL}/deck/improve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leader_id: leaderId,
      card_ids: cardIds,
      ...(simCardStats ? { sim_card_stats: simCardStats } : {}),
    }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function fetchSimDetail(simId: string): Promise<SimDetail> {
  const resp = await fetch(`${BASE_URL}/deck/sim-detail/${simId}`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function analyzeMatchup(
  leaderId: string,
  cardIds: string[],
  simId: string,
): Promise<MatchupAnalysis> {
  const resp = await fetch(`${BASE_URL}/deck/analyze-matchup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds, sim_id: simId }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function clearSimHistory(
  leaderId: string,
  cardIds: string[],
): Promise<{ status: string; message: string }> {
  const resp = await fetch(`${BASE_URL}/deck/clear-sim-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function aggregateDeckAnalysis(
  leaderId: string,
  cardIds: string[],
): Promise<DeckHealthAnalysis> {
  const resp = await fetch(`${BASE_URL}/deck/aggregate-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leader_id: leaderId, card_ids: cardIds }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function fetchSimulationAnalytics(): Promise<SimAnalyticsResponse> {
  const resp = await fetch(`${BASE_URL}/simulator/analytics`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function fetchProviderModels(
  provider: string,
  apiKey?: string,
): Promise<ProviderModelsResult> {
  const params = new URLSearchParams();
  if (apiKey) params.set('api_key', apiKey);
  const resp = await fetch(`${BASE_URL}/settings/provider-models/${provider}?${params}`);
  return resp.json();
}
