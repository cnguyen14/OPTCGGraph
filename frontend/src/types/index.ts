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
