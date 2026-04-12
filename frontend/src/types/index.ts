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
  shared_families?: string[];
  shared_keywords?: string[];
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
  times_drawn: number;
  times_played: number;
  total_games: number;
  times_in_winning_game: number;
  damage_contributed: number;
  times_koed: number;
  avg_turn_played: number;
  times_countered_with: number;
  times_blocked_with: number;
  effects_triggered: number;
}

export interface GameReplayEntry {
  turn: number;
  player: string;
  phase: string;
  action: string;
  details: Record<string, unknown>;
}

export interface TurnSnapshot {
  turn: number;
  active: string;
  p1: {
    life: number;
    hand: number;
    field: number;
    power: number;
    don: number;
    deck: number;
    eval: number;
  };
  p2: {
    life: number;
    hand: number;
    field: number;
    power: number;
    don: number;
    deck: number;
    eval: number;
  };
}

export interface SampleGame {
  winner: string;
  turns: number;
  p1_life: number;
  p2_life: number;
  win_condition: string;
  p1_mulligan: boolean;
  p2_mulligan: boolean;
  p1_effects: number;
  p2_effects: number;
  p1_damage: number;
  p2_damage: number;
  decision_count: number;
  turn_snapshots: TurnSnapshot[];
  game_log: GameReplayEntry[];
}

export interface EnhancedStats {
  mulligan_rate_p1: number;
  mulligan_rate_p2: number;
  mulligan_win_rate: number;
  win_by_lethal: number;
  win_by_deckout: number;
  win_by_timeout: number;
  first_player_win_rate: number;
  avg_effects_per_game: number;
  avg_p1_damage: number;
  avg_p2_damage: number;
  total_decisions: number;
  avg_decisions_per_game: number;
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
  enhanced_stats?: EnhancedStats;
  export_path?: string;
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
  bandai?: CrawlSourceStatus;
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

// Deck Analysis types
export interface DeckAnalysis {
  validation: {
    checks: Array<{ name: string; status: 'pass' | 'fail' | 'warning'; message: string }>;
    pass_count: number;
    fail_count: number;
    warning_count: number;
  };
  playstyle: string;
  synergy_score: number;
  suggestions: Array<{ type: string; remove?: string; add?: string; priority: string }>;
  card_roles: {
    blockers: number;
    removal: number;
    draw: number;
    searcher: number;
    rush: number;
    finishers: number;
  };
  cost_curve: Record<string, number>;
}

export interface SimHistoryEntry {
  sim_id: string;
  opponent_leader: string;
  win_rate: number;
  num_games: number;
  avg_turns: number;
  mode: string;
  model: string | null;
  timestamp: string;
}

export interface DeckImprovement {
  action: string;
  remove?: { card_id: string; card_name: string; reason: string };
  add?: { card_id: string; card_name: string; reason: string };
  impact: string;
}

export interface DeckImprovements {
  improvements: DeckImprovement[];
  summary: string;
}

export interface SimDetail {
  metadata: {
    p1_leader: string;
    p2_leader: string;
    num_games: number;
    mode: string;
    llm_model: string | null;
    p1_level: string;
    p2_level: string;
  };
  games: Array<{
    game_idx: number;
    winner: string;
    turns: number;
    p1_life: number;
    p2_life: number;
    p1_damage_dealt: number;
    p2_damage_dealt: number;
    p1_effects_fired: number;
    p2_effects_fired: number;
    p1_mulligan: boolean;
    p2_mulligan: boolean;
    win_condition: string;
    decision_count: number;
  }>;
}

export interface SwapCandidate {
  card_id: string;
  name: string;
  image: string;
  power: number | null;
  cost: number | null;
  counter: number | null;
  synergy_score: number;
  synergy_count?: number;
}

export interface SuggestedSwap {
  remove: string;
  remove_name: string;
  remove_image: string;
  role_needed: string;
  reason: string;
  candidates: SwapCandidate[];
}

export interface MatchupAnalysis {
  analysis: string;
  strengths: string[];
  weaknesses: string[];
  overperformers: Array<{ card_id: string; card_name: string; reason: string }>;
  underperformers: Array<{ card_id: string; card_name: string; reason: string }>;
  suggested_swaps: SuggestedSwap[];
  detailed_stats?: DetailedSimStats;
}

// --- Aggregate Deck Health Analysis ---

export interface CardHealthEntry {
  card_id: string;
  card_name: string;
  times_played: number;
  play_rate: number;
  win_correlation: number;
  category: string;
}

export interface SynergyPair {
  card_a: string;
  card_b: string;
  co_occurrence_rate: number;
  win_lift: number;
}

export interface MatchupSpread {
  opponent: string;
  win_rate: number;
  num_games: number;
}


export interface ReplacementSuggestion {
  remove_id: string;
  remove_name: string;
  remove_image: string;
  role_needed: string;
  reason: string;
  candidates: SwapCandidate[];
}

export interface DeckHealthAnalysis {
  summary: string;
  consistency_rating: string;
  total_sims: number;
  total_games: number;
  overall_win_rate: number;
  strengths: string[];
  weaknesses: string[];
  core_engine: CardHealthEntry[];
  dead_cards: CardHealthEntry[];
  role_gaps: string[];
  synergy_insights: string[];
  improvement_priorities: string[];
  card_health: CardHealthEntry[];
  top_synergies: SynergyPair[];
  matchup_spread: MatchupSpread[];
  suggested_swaps: ReplacementSuggestion[];
}

export interface DetailedSimStats {
  card_performance: CardPerformanceDetail[];
  turn_momentum: Array<{ turn: number; avg_p1_eval: number; avg_p2_eval: number }>;
  action_patterns: {
    play_before_attack_pct: number;
    leader_attack_pct: number;
    losing_attack_pct: number;
    avg_decisions_per_game: number;
    action_distribution?: Record<string, number>;
    don_to_leader_pct?: number;
  };
  game_summaries: Array<{
    game_idx: number;
    winner: string;
    turns: number;
    p1_life: number;
    p2_life: number;
    critical_turns: number[];
  }>;
}

export interface CardPerformanceDetail {
  card_name: string;
  times_played: number;
  play_rate: number;
  avg_turn_played: number;
  win_pct: number;
  in_winning_games: number;
  in_losing_games: number;
}

// Simulation Analytics types
export interface SimAnalyticsStats {
  p1_win_rate: number;
  avg_turns: number;
  avg_p1_damage: number;
  avg_p2_damage: number;
  avg_p1_life_remaining: number;
  avg_decisions_per_game: number;
  first_player_win_rate: number;
  p1_mulligan_rate: number;
  p2_mulligan_rate: number;
  p1_wins: number;
  p2_wins: number;
  draws: number;
  action_distribution: Record<string, number>;
  leader_attack_pct: number;
  don_to_leader_pct: number;
  losing_attack_pct: number;
  play_before_attack_pct: number;
}

export interface SimCardStat {
  name: string;
  times_played: number;
  games_appeared: number;
  win_pct: number;
}

export interface TurnMomentum {
  turn: number;
  avg_p1_eval: number;
  avg_p2_eval: number;
}

export interface SimAnalyticsEntry {
  sim_id: string;
  folder: string;
  timestamp: string;
  model: string | null;
  mode: string;
  p1_leader: string;
  p2_leader: string;
  p1_level: string;
  p2_level: string;
  num_games: number;
  stats: SimAnalyticsStats;
  card_stats: Record<string, SimCardStat>;
  turn_momentum: TurnMomentum[];
}

export interface SimAnalyticsResponse {
  simulations: SimAnalyticsEntry[];
}
