export interface Card {
  id: string;
  code: string;
  name: string;
  card_type: string;
  cost: number | null;
  power: number | null;
  counter: number | null;
  rarity: string;
  attribute: string;
  color: string;
  ability: string;
  trigger_effect: string;
  image_small: string;
  image_large: string;
  inventory_price: number | null;
  market_price: number | null;
  life: string;
  colors: string[];
  families: string[];
  set_name: string;
  keywords: string[];
  banned?: boolean;
  ban_reason?: string;
}

export interface SynergyPartner {
  id: string;
  name: string;
  card_type: string;
  cost: number | null;
  power: number | null;
  color: string;
  image_small: string;
}

export interface GraphNode {
  id: string;
  name: string;
  group: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
}

export interface DeckEntry {
  card: Card;
  quantity: number;
}

export interface DeckState {
  leader: Card | null;
  cards: Card[];
  totalCost: number;
}

export interface CurveEntry {
  cost: number;
  count: number;
  cards: string[];
}

export interface HubCard {
  id: string;
  name: string;
  degree: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AgentState {
  currentDeck: DeckState;
  graphState: {
    highlightedNodes: string[];
    focusedSubgraph: string | null;
  };
  panels: {
    cardDetail: Card | null;
    comparison: Card[];
  };
  suggestions: string[];
  modelConfig: {
    provider: 'claude' | 'openrouter';
    model: string;
    tier: 1 | 2 | 3;
  };
}

export interface CardSearchParams {
  keyword?: string;
  color?: string;
  card_type?: string;
  family?: string;
  set_name?: string;
  rarity?: string;
  cost_min?: number;
  cost_max?: number;
  sort_by?: 'name' | 'cost' | 'power' | 'market_price';
  sort_order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface CardSearchResponse {
  cards: Card[];
  total: number;
  offset: number;
  limit: number;
}

export interface SetFacet {
  id: string;
  name: string;
}

export interface Facets {
  colors: string[];
  card_types: string[];
  families: string[];
  sets: SetFacet[];
  rarities: string[];
}

// Validation types
export interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  message: string;
  details: Record<string, unknown>;
}

export interface ValidationReport {
  leader_id: string;
  leader_name: string;
  deck_size: number;
  is_legal: boolean;
  summary: string;
  stats: { pass: number; fail: number; warning: number };
  checks: CheckResult[];
}

export interface SuggestionCard {
  id: string;
  name: string;
  reason?: string;
  cost?: number | null;
  counter?: number | null;
  benefit?: string;
}

export interface Suggestion {
  type: 'rule_fix' | 'quality_improvement';
  check_name: string;
  remove: SuggestionCard;
  add: SuggestionCard;
  priority: 'high' | 'medium' | 'low';
}

export interface SuggestFixesResponse {
  suggestions: Suggestion[];
  validation: ValidationReport;
}

// Meta / Tournament types
export interface Tournament {
  id: string;
  name: string;
  date: string;
  format: string;
  player_count: number;
}

export interface MetaDeckSummary {
  id: string;
  leader_id: string;
  leader_name: string;
  archetype: string;
  placement: number | null;
  player_name: string;
  tournament: Tournament | null;
}

export interface MetaDeckCard {
  id: string;
  name: string;
  card_type: string;
  cost: number | null;
  power: number | null;
  counter: number | null;
  count: number;
  image_small: string;
  keywords: string[];
}

export interface MetaDeckDetail extends MetaDeckSummary {
  cards: MetaDeckCard[];
  total_cards: number;
  type_distribution: Record<string, number>;
  leader_image: string;
}

export interface MetaOverview {
  total_decks: number;
  total_tournaments: number;
  top_archetypes: { archetype: string; count: number; share: number }[];
  top_leaders: { id: string; name: string; deck_count: number }[];
}

export interface SwapSuggestion {
  remove_id: string;
  remove_name: string;
  add_id: string;
  add_name: string;
  reason: string;
}

// Simulator types
export interface SimulationProgress {
  completed: number;
  total: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
}

export interface CardPerformance {
  card_id: string;
  card_name: string;
  times_played: number;
  total_games: number;
  times_in_winning_game: number;
}

export interface GameReplayEntry {
  turn: number;
  player: string;
  phase: string;
  action: string;
  details: Record<string, unknown>;
}

export interface SampleGame {
  winner: string;
  turns: number;
  p1_life: number;
  p2_life: number;
  game_log: GameReplayEntry[];
}

export interface SimulationResult {
  num_games: number;
  p1_wins: number;
  p2_wins: number;
  draws: number;
  avg_turns: number;
  p1_leader: string;
  p2_leader: string;
  p1_win_rate: number;
  p2_win_rate: number;
  card_stats: Record<string, CardPerformance>;
  sample_games: SampleGame[];
}

// Saved Deck types
export interface SavedDeck {
  id: string;
  name: string;
  description: string;
  leader_id: string | null;
  entries: { card_id: string; quantity: number }[];
  deck_notes: string;
  created_at: string;
  updated_at: string;
}

export interface SavedDeckListItem {
  id: string;
  name: string;
  description: string;
  leader_id: string | null;
  card_count: number;
  created_at: string;
  updated_at: string;
}

// Settings / Dashboard types
export interface SystemStatus {
  neo4j: boolean;
  redis: boolean;
  neo4j_uri: string;
  redis_url: string;
  api_keys: {
    anthropic: boolean;
    openrouter: boolean;
    apitcg: boolean;
  };
  runtime_keys: {
    anthropic: boolean;
    openrouter: boolean;
    apitcg: boolean;
  };
}

export interface TestKeyResult {
  status: 'ok' | 'error';
  message: string;
}

export interface ProviderModelsResult {
  status: 'ok' | 'error';
  message?: string;
  models: ModelInfo[];
}

export interface CrawlSourceStatus {
  last_run: string | null;
  count: number;
}

export interface CrawlStatus {
  apitcg: CrawlSourceStatus;
  optcgapi: CrawlSourceStatus;
  limitlesstcg: CrawlSourceStatus;
  banned: CrawlSourceStatus;
}

export interface BannedCard {
  id: string;
  name: string;
  ban_reason: string;
  image_small?: string;
  card_type?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  tier: number;
}

export interface ModelsResponse {
  current: { provider: string; model: string };
  available: Record<string, ModelInfo[]>;
}
