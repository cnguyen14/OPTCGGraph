import type { CardSearchParams, CardSearchResponse, Facets } from '../types';

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

export async function chatSync(message: string, sessionId?: string, leaderId?: string) {
  const resp = await fetch(`${BASE_URL}/ai/chat/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId, leader_id: leaderId }),
  });
  return resp.json();
}

export async function fetchModels() {
  const resp = await fetch(`${BASE_URL}/settings/models`);
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
