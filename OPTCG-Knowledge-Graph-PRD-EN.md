# PRD: OPTCG Knowledge Graph — AI-Powered Deck Building Platform

**Version:** 0.3  
**Author:** Chien  
**Date:** March 29, 2026  
**Status:** Draft

---

## 1. Vision & Problem Statement

### Problem
One Piece TCG (OPTCG) card data currently exists in flat/relational form — lists of cards with properties. When an AI agent needs to research and build a deck, it must scan the entire card list, apply multiple filters, and lacks context about the relationships between cards. This leads to:

- **Slow context retrieval:** The agent must load thousands of cards into its context window to discover synergies
- **Missing implicit relationships:** Flat data cannot capture "Card A synergizes with Card B because they share family + keyword mechanics"
- **No traversal capability:** Queries like "find all cards with 2-hop synergy from Leader X" are impossible with relational data
- **Wasted tokens:** The agent must dump the entire card database into context instead of pulling only the relevant subgraph

### Vision
Build an AI-powered OPTCG platform with a Knowledge Graph at its core. Each card is a node with rich relationships (synergy, counters, mechanical links, family bonds). An embedded AI layer uses the graph as its knowledge base to analyze cards, evaluate deck strategies, and assist users in building competitive decks — all backed by real graph traversal rather than guesswork.

### End-State User Experience
A user selects a Leader, and the AI:
1. Queries the knowledge graph for all synergy paths from that Leader
2. Suggests a core shell of cards with explanation of WHY each card fits (family synergy, keyword mechanics, curve optimization)
3. Identifies weaknesses in the build and recommends tech cards to counter meta threats
4. Provides price-aware suggestions (budget vs optimal builds)

---

## 2. Data Sources

### 2.1 Primary: apitcg.com (Card Mechanics)
- **Base URL:** `https://apitcg.com/api/one-piece/cards`
- **Auth:** API key required (free plan: 1000 requests/month)
- **Pagination:** 25 cards per page, returns `page`, `limit`, `total`, `totalPages`
- **Filter params:** `property` + `value` (filterable: id, code, rarity, type, name, cost, power, counter, color, family, ability, trigger)

**Sample response per card:**
```json
{
  "id": "OP03-070",
  "code": "OP03-070",
  "rarity": "R",
  "type": "CHARACTER",
  "name": "Monkey.D.Luffy",
  "images": {
    "small": "https://en.onepiece-cardgame.com/images/cardlist/card/OP03-070.png",
    "large": "https://en.onepiece-cardgame.com/images/cardlist/card/OP03-070.png"
  },
  "cost": 6,
  "attribute": {
    "name": "Strike",
    "image": "..."
  },
  "power": 7000,
  "counter": "-",
  "color": "Purple",
  "family": "Water Seven/Straw Hat Crew",
  "ability": "[On Play] DON!! −1 ... This Character gains [Rush] during this turn.",
  "trigger": "",
  "set": {
    "name": "-PILLARS OF STRENGTH- [OP03]"
  }
}
```

**Crawl budget:** ~2000-3000 total cards ÷ 25 per page = ~120-130 requests. Well within the free plan limit of 1000/month.

### 2.2 Secondary: optcgapi.com (Pricing + Images)
- **Base URL:** `https://optcgapi.com/api/`
- **Auth:** None required (no API key needed)
- **Rate limit:** No hard limit, but be respectful (1-2s delay between requests)
- **Key endpoints:**
  - `/api/allSetCards/` — all set cards
  - `/api/allSTCards/` — all starter deck cards
  - `/api/allPromoCards/` — all promo cards
  - `/api/allDonCards/` — all DON!! cards
  - `/api/sets/card/{card_id}/` — individual card with pricing
- **Coverage:** OP-01 through OP-14, all starter decks, promo cards
- **Unique data:** `inventory_price`, `market_price`, yesterday's prices, `card_image`, `card_image_id`

### 2.3 Merge Strategy
- **Join key:** Card ID (both APIs use identical format: `OP01-001`, `ST13-003`, etc.)
- **Conflict resolution:** apitcg is primary for game mechanics fields; optcgapi is primary for pricing and images
- **Crawl order:** apitcg first (mechanics) → optcgapi second (pricing/images) → merge into unified records

---

## 3. Architecture

### 3.1 Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Package Manager** | uv | Fast Python package manager, replaces pip. Use `uv init`, `uv add`, `uv run` for all Python operations |
| **Crawl & ETL** | Python + httpx | Async-capable HTTP client, better than requests for batch crawling |
| **Knowledge Graph** | Neo4j Community Edition | Graph database from day 1. No migration cost later. Cypher query language is purpose-built for traversal. Free, supports billions of nodes, single-node deployment is sufficient |
| **Ability Parser** | Claude API (claude-sonnet-4-20250514) | Parses raw ability text into structured keywords/mechanics via batch processing |
| **Backend API** | FastAPI + AG-UI adapter | REST endpoints + AG-UI event streaming for real-time agent↔frontend communication |
| **Primary AI** | Claude API (Anthropic, direct) | Default model. Direct connection for lowest latency and full feature support (extended thinking, structured outputs). Highest accuracy for tool use |
| **Secondary AI** | OpenRouter API | Unified gateway to 300+ models (GPT, Gemini, Llama, Mistral, etc.). User-selectable in settings. OpenAI-compatible tool calling format auto-transforms for all providers |
| **Agent Transport** | AG-UI Protocol | Open, event-based protocol for agent↔frontend communication. SSE streaming. ~16 event types for messages, tool calls, state patches, UI commands |
| **Frontend** | Vite + React + TypeScript | Fast dev server, HMR, modern build tooling |
| **Frontend Agent SDK** | CopilotKit | React components for AG-UI: streaming chat, frontend tool calling, shared state sync, human-in-the-loop |
| **Styling** | Tailwind CSS v4 | Utility-first CSS, v4 with new engine for faster builds |
| **Graph Visualization** | D3.js | Force-directed graph rendering, interactive node exploration |
| **Session Memory** | Redis (production) / SQLite (dev) | Server-side conversation persistence for multi-turn sessions |
| **Neo4j Driver** | neo4j (Python) | Official Neo4j Python driver for Bolt protocol |

### 3.2 System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        DATA PIPELINE                              │
│                                                                    │
│  apitcg.com ──→ ┌───────────┐      ┌─────────────────────┐        │
│  (mechanics)    │  Crawler   │──→   │     Neo4j Graph     │        │
│  optcgapi.com ─→│  + Merge   │      │   (source of truth) │        │
│  (pricing)      └───────────┘      └─────────┬───────────┘        │
│                       │                       │                    │
│                       ▼                       │                    │
│              ┌──────────────┐                 │                    │
│              │ LLM Ability  │─── parsed ──→   │                    │
│              │   Parser     │    keywords      │                    │
│              └──────────────┘                 │                    │
└───────────────────────────────────────────────│────────────────────┘
                                                │
         ┌──────────────────────────────────────┼──────────────────┐
         │              BACKEND (FastAPI)        │                  │
         │                                      │                  │
         │  ┌──────────────────────────────────────────────────┐   │
         │  │            AI AGENT RUNTIME                       │   │
         │  │                                                   │   │
         │  │  ┌─────────────┐    ┌───────────────────────┐    │   │
         │  │  │   Agentic   │    │    LLM Providers      │    │   │
         │  │  │    Loop     │───→│                       │    │   │
         │  │  │  (tools +   │    │  ┌─────────────────┐  │    │   │
         │  │  │   memory)   │◄───│  │ Claude (direct) │  │    │   │
         │  │  └──────┬──────┘    │  │ (default/fast)  │  │    │   │
         │  │         │           │  ├─────────────────┤  │    │   │
         │  │         │           │  │ OpenRouter       │  │    │   │
         │  │         ▼           │  │ (300+ models)   │  │    │   │
         │  │  ┌──────────────┐   │  └─────────────────┘  │    │   │
         │  │  │  Neo4j Tools │   └───────────────────────┘    │   │
         │  │  │  (query,     │                                │   │
         │  │  │   analyze)   │                                │   │
         │  │  └──────────────┘                                │   │
         │  └──────────────────────────────────────────────────┘   │
         │                         │                                │
         │              ┌──────────▼──────────┐                     │
         │              │  AG-UI Event Stream │                     │
         │              │  (SSE / WebSocket)  │                     │
         │              └──────────┬──────────┘                     │
         │                         │                                │
         │  ┌──────────────┐  ┌────▼─────┐  ┌──────────────────┐   │
         │  │ Graph Query  │  │ Session  │  │  Data Management │   │
         │  │  Endpoints   │  │ Memory   │  │    Endpoints     │   │
         │  └──────────────┘  │ (Redis)  │  └──────────────────┘   │
         │                    └──────────┘                          │
         └────────────────────────┬─────────────────────────────────┘
                                  │
         ┌────────────────────────▼─────────────────────────────────┐
         │         FRONTEND (Vite + React + CopilotKit + D3)        │
         │                                                          │
         │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
         │  │  Graph   │ │  Deck    │ │   AI     │ │  Settings  │  │
         │  │ Explorer │ │ Builder  │ │ Chat +   │ │  (model    │  │
         │  │  (D3)    │ │          │ │ UI Ctrl  │ │  selector) │  │
         │  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
         └──────────────────────────────────────────────────────────┘
```

### 3.3 Why Neo4j from Day 1

- **No migration tax:** Building on NetworkX first then migrating to Neo4j means rewriting all query logic. Start with Cypher from the beginning.
- **Cypher is purpose-built:** Queries like `MATCH (c:Card)-[:SYNERGY*1..3]-(partner) WHERE c.id = 'OP03-070' RETURN partner` are native to Neo4j. In NetworkX this requires manual BFS/DFS code.
- **AI agent integration:** The AI layer can generate Cypher queries dynamically. Much cleaner than Python function calls to NetworkX.
- **Persistence is free:** Neo4j persists to disk automatically. No pickle files, no manual serialization.
- **Community Edition is sufficient:** Free, no node/edge limits that matter for ~3000 cards + ~20,000 edges. Single-instance is fine for this scale.
- **Visualization tools built-in:** Neo4j Browser provides instant graph visualization for debugging, complementing the custom D3 frontend.

---

## 4. Data Model

### 4.1 Neo4j Graph Schema

#### Node Types & Properties

```cypher
-- Card node (core entity)
(:Card {
  id: "OP03-070",
  code: "OP03-070",
  name: "Monkey.D.Luffy",
  card_type: "CHARACTER",       -- CHARACTER | LEADER | EVENT | STAGE
  cost: 6,
  power: 7000,
  counter: 0,                   -- 0 | 1000 | 2000
  rarity: "R",                  -- C | UC | R | SR | SEC | L
  attribute: "Strike",          -- Strike | Ranged | Wisdom | Special
  ability: "raw text...",
  trigger_effect: "",
  image_small: "url",
  image_large: "url",
  inventory_price: 0.50,
  market_price: 0.75,
  source_apitcg: true,
  source_optcgapi: true
})

-- Supporting nodes
(:Color { name: "Purple" })
(:Family { name: "Straw Hat Crew" })
(:Set { id: "OP03", name: "PILLARS OF STRENGTH", release_date: "2023-06-30" })
(:Keyword { name: "Rush", category: "ability" })
(:CostTier { name: "High", range_min: 5, range_max: 6 })
(:Archetype { name: "Purple DON!! Control", description: "..." })
```

#### Edge Types

```cypher
-- Property edges (from raw data)
(card)-[:HAS_COLOR]->(color)
(card)-[:BELONGS_TO]->(family)
(card)-[:FROM_SET]->(set)
(card)-[:HAS_KEYWORD]->(keyword)
(card)-[:IN_COST_TIER]->(tier)

-- Computed synergy edges (auto-generated)
(card)-[:SYNERGY { weight: 2, shared_families: ["Straw Hat Crew", "Water Seven"] }]->(card)
(card)-[:MECHANICAL_SYNERGY { weight: 3, shared_keywords: ["On Play", "DON!! Minus", "Bounce"] }]->(card)
(card)-[:CURVES_INTO { cost_diff: 2 }]->(card)

-- LLM-derived strategic edges
(card)-[:COUNTERS { reason: "Bounces high-cost targets" }]->(card)
(card)-[:SEARCHES_FOR { condition: "cost <= 5 AND family = Straw Hat Crew" }]->(card)
(card)-[:TRIGGERS { condition: "When a character is played" }]->(card)

-- Deck building edges
(card)-[:LED_BY { synergy_score: 0.85 }]->(leader:Card { card_type: "LEADER" })
(card)-[:PART_OF_ARCHETYPE { confidence: 0.9 }]->(archetype)
```

#### Key Indexes

```cypher
CREATE INDEX card_id FOR (c:Card) ON (c.id);
CREATE INDEX card_name FOR (c:Card) ON (c.name);
CREATE INDEX card_cost FOR (c:Card) ON (c.cost);
CREATE INDEX card_type FOR (c:Card) ON (c.card_type);
CREATE FULLTEXT INDEX card_ability FOR (c:Card) ON EACH [c.ability];
```

### 4.2 Derived/Computed Edge Logic

| Edge | Computation Rule |
|------|-----------------|
| `SYNERGY` | Auto: cards sharing ≥1 family within the same color. Weight = number of shared families |
| `MECHANICAL_SYNERGY` | Auto: cards sharing ≥2 parsed keywords. Weight = number of shared keywords |
| `CURVES_INTO` | Auto: same family + color, cost difference of 1-2, complementary roles |
| `COUNTERS` | LLM: ability text indicates removal/negation of specific strategies |
| `SEARCHES_FOR` | LLM: ability contains "add from deck", "look at top X", "play from trash" |
| `TRIGGERS` | LLM: "when X happens" conditions that match other cards' effects |
| `LED_BY` | LLM + Auto: card's family/color/mechanics align with a Leader's ability |

---

## 5. Ability Parser (LLM-based)

### 5.1 Problem
The API returns raw ability text. Example:
```
"[On Play] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.) You may trash 1 Character card with a cost of 5 from your hand: This Character gains [Rush] during this turn."
```

This needs to be decomposed into structured data for graph edges.

### 5.2 Parser Output Format
```json
{
  "timing_keywords": ["On Play"],
  "cost_conditions": [
    { "type": "DON!! Minus", "amount": 1 }
  ],
  "additional_costs": [
    { "type": "trash_from_hand", "target": "Character", "cost_condition": 5 }
  ],
  "effects": [
    { "type": "self_buff", "keyword_granted": "Rush", "duration": "this_turn" }
  ],
  "targets": {
    "self": true,
    "opponent_cards": false,
    "own_cards": false
  },
  "extracted_keywords": ["On Play", "DON!! Minus", "Rush", "Trash"]
}
```

### 5.3 Implementation
- Use Claude API (claude-sonnet-4-20250514) with structured output prompt
- Batch process: send 10-20 ability texts per request to minimize API calls
- Store parsed results as properties on Card nodes + create Keyword edges in Neo4j
- Total cost estimate: ~3000 cards ÷ 15 per batch = ~200 API calls

### 5.4 Known OPTCG Keywords to Extract
```
Timing: On Play, When Attacking, On Block, End of Turn, Activate Main, On K.O., On Your Opponent's Attack
Abilities: Rush, Blocker, Double Attack, Banish, On K.O.
DON!! Mechanics: DON!! Minus, DON!! Plus, DON!! x1/x2
Effects: Bounce (return to hand), Draw, Trash, KO, Search (look/add from deck), Power Buff, Counter
Targeting: cost conditions (cost ≤ X, cost = X), type conditions (Character only, Leader only)
```

---

## 6. AI Layer

### 6.1 Core Principle: Accuracy Over Speed
The AI must understand OPTCG game mechanics deeply enough to reason about card interactions — not just keyword-match. When a user says "I hate this card, find me something to beat it," the AI must:
1. Analyze the threat card's full ability (timing, targets, conditions, cost)
2. Reason about what strategies neutralize that threat (not just text matching)
3. Query the graph for cards that implement those strategies
4. Explain WHY each suggestion works in game-mechanical terms

The AI should never hallucinate card effects or invent cards. Every recommendation must reference a real card in the graph with verifiable properties.

### 6.2 Game Knowledge System
The AI needs an embedded understanding of OPTCG rules and strategic concepts. This is injected as a system prompt, not stored in the graph.

**Core Rules the AI Must Know:**
```
TURN STRUCTURE:
- Refresh Phase → Draw Phase → DON!! Phase (+2 DON!!) → Main Phase → End Phase
- During Main Phase: play Characters/Events/Stages, attach DON!!, attack

COMBAT:
- Attacker declares target (Leader or rested Character)
- Defender can activate Counter Step (play Counter events, use hand counters)
- Compare power: attacker power ≥ defender power = KO / Life lost

DON!! ECONOMY:
- Start with 0, gain 2 per turn (max 10 on field)
- DON!! can be attached to Characters/Leader for +1000 power each
- DON!! Minus returns DON!! from field to DON!! deck (cost for powerful effects)
- DON!! Plus adds DON!! from DON!! deck to field (ramp)

KEY MECHANICS:
- Rush: can attack the turn it's played (normally characters have summoning sickness)
- Blocker: can rest to redirect an attack to itself (defensive)
- Double Attack: if this attack removes a Life card, trigger one more Life check
- Banish: removed cards go to bottom of deck instead of trash (denies On K.O. triggers)
- Counter +X000: can be played from hand during Counter Step to boost power

TIMING WINDOWS:
- On Play: triggers when the card enters the field from hand
- When Attacking: triggers when this card declares an attack
- On K.O.: triggers when this card is KO'd (sent to trash)
- Activate Main: player can manually activate during their Main Phase
- On Your Opponent's Attack: triggers during opponent's attack (defensive)
- Counter: can be activated during Counter Step only

WIN CONDITION:
- Reduce opponent's Life to 0, then deal one final attack to their Leader
```

**Strategic Concepts the AI Must Reason About:**
```
TEMPO: Playing threats faster than opponent can answer them
CARD ADVANTAGE: Generating more cards (draw, search) than opponent
BOARD CONTROL: Removing opponent's characters (KO, bounce, trash)
DON!! EFFICIENCY: Getting maximum effect per DON!! spent
CURVE: Having playable options at each cost level (1→2→3→4→5→...)
COUNTER DENSITY: Having enough counter values in deck to survive attacks
AGGRO vs CONTROL: Fast damage vs resource denial
MIDRANGE: Balancing board presence with removal
```

### 6.3 AI Reasoning Pipeline

```
User Question
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  STEP 1: UNDERSTAND INTENT                          │
│  Parse what user actually needs:                     │
│  - Counter a specific card?                          │
│  - Build a deck?                                     │
│  - Evaluate a card?                                  │
│  - Compare options?                                  │
│  - Understand an interaction?                        │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  STEP 2: ANALYZE THE PROBLEM                        │
│  Using game knowledge, reason about:                 │
│  - What makes the threat dangerous? (timing, effect) │
│  - What strategies neutralize it?                    │
│  - What card properties would implement those        │
│    strategies?                                       │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  STEP 3: QUERY THE GRAPH                            │
│  Generate precise Cypher queries based on analysis:  │
│  - Find cards matching the counter-strategy criteria │
│  - Pull synergy context for each candidate          │
│  - Get pricing data for budget considerations       │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  STEP 4: REASON & RANK                              │
│  Evaluate candidates using game knowledge:           │
│  - How effectively does each card counter the threat?│
│  - Does it fit the user's deck (color, family)?     │
│  - What's the cost/benefit tradeoff?                │
│  - Are there side benefits (synergy with other cards)│
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  STEP 5: GROUNDED RESPONSE                          │
│  Present recommendations with:                       │
│  - Card name, ID, cost, power (from graph)          │
│  - WHY it works (game-mechanical reasoning)         │
│  - HOW to use it (timing, play pattern)             │
│  - Tradeoffs and alternatives                       │
└─────────────────────────────────────────────────────┘
```

### 6.4 Example: Counter-Play Analysis

```
User: "I hate OP05-060 Trafalgar Law. It keeps bouncing my big cards.
       What can I use to beat it?"

STEP 1 — UNDERSTAND:
  User wants to counter a specific card (OP05-060 Trafalgar Law)

STEP 2 — ANALYZE THE THREAT:
  AI reads Law's ability from graph:
  "[On Play] DON!! −1: Return up to 1 Character with a cost of 7 or less
   to the owner's hand."

  AI reasons:
  - Threat type: BOUNCE (return to hand, not KO — so On K.O. doesn't trigger)
  - Timing: ON PLAY (triggers once when Law enters the field)
  - Target: any Character cost ≤ 7 (very wide range)
  - Cost: Law costs 7 + DON!! −1 = effectively 8 DON!! investment
  - Weakness analysis:
    a) Law is a one-time effect (On Play, not repeating)
    b) Law costs 7 — he's a big investment himself
    c) Law targets cost ≤ 7 — cards cost 8+ are immune
    d) Bounce returns to HAND — the card isn't lost, just tempo loss
    e) Law himself has 7000 power — vulnerable to KO effects

  Counter strategies identified:
  1. PLAY LOW-COST SWARM: spread board wide so bouncing 1 card doesn't matter
  2. USE COST 8+ THREATS: immune to Law's targeting
  3. KO LAW BEFORE EFFECT: cards that remove characters during opponent's turn
  4. "WHEN LEAVES FIELD" EFFECTS: cards that benefit from being bounced
  5. BLOCKER WALL: prevent Law from attacking after entering play
  6. RE-PLAY ADVANTAGE: cards with strong On Play effects that WANT to be bounced

STEP 3 — QUERY GRAPH:
  Cypher 1: Find low-cost characters with strong board presence
    MATCH (c:Card)
    WHERE c.card_type = 'CHARACTER' AND c.cost <= 3 AND c.power >= 4000
    RETURN c

  Cypher 2: Find cost 8+ characters
    MATCH (c:Card)
    WHERE c.card_type = 'CHARACTER' AND c.cost >= 8
    RETURN c

  Cypher 3: Find cards with KO/removal that work reactively
    MATCH (c:Card)-[:HAS_KEYWORD]->(k:Keyword)
    WHERE k.name IN ['KO', 'Bounce', 'When Attacking']
    AND c.power >= 7000
    RETURN c

  Cypher 4: Find cards with On Play effects that benefit from being replayed
    MATCH (c:Card)-[:HAS_KEYWORD]->(k:Keyword {name: 'On Play'})
    MATCH (c)-[:HAS_KEYWORD]->(k2:Keyword)
    WHERE k2.name IN ['Draw', 'Search', 'KO']
    AND c.cost <= 5
    RETURN c

STEP 4 — REASON & RANK:
  AI evaluates each candidate against the counter strategies,
  checks color compatibility with user's deck, considers curve impact

STEP 5 — RESPOND:
  "Law's bounce targets cost ≤ 7 and triggers On Play, so here are
   your best counter approaches:

   STRATEGY 1 — Go wide with low-cost threats:
   [OP03-060 Nico Robin, cost 3] — If Law bounces her, you replay her
   and draw ANOTHER card from her On Play. Law spent 7 cost + 1 DON!!
   to bounce your 3-cost that replaces itself. That's a terrible trade
   for your opponent.

   STRATEGY 2 — Go over the targeting range:
   [OP0X-XXX, cost 8+] — Law literally cannot target this. Your opponent
   spent 7 + DON!! −1 and got nothing.

   STRATEGY 3 — Punish Law himself:
   [OP03-058 Kaku, cost 4] — KO's characters cost ≤ 3 on play, but more
   importantly, if you have board presence when Law drops, you can attack
   into Law's 7000 power with DON!! attached characters to KO him before
   he provides further value.

   The key insight: Law is a TEMPO play, not card advantage. He doesn't
   destroy your card — just delays it. Build your deck so that delay
   doesn't matter (cheap re-playable cards) or doesn't apply (cost 8+)."
```

### 6.5 AI Features Summary

**Card Analysis:**
- Deep breakdown of any card's strengths, weaknesses, and optimal use cases
- Synergy count, archetype fit, and price-to-value ratio from graph data

**Counter-Play Advisor:**
- Analyze any threat card's mechanics and identify counter strategies
- Recommend specific cards with game-mechanical reasoning for WHY they work
- Consider the user's deck context (color, family, budget)

**Deck Building Assistant:**
- Leader selection → AI suggests core shell with curve optimization
- Gap analysis: identifies missing roles (no removal, no draw, weak to aggro)
- Budget mode: affordable alternatives with similar graph connectivity
- Tech card suggestions based on meta threats

**Meta Analysis:**
- Archetype matchup analysis via COUNTERS edge traversal
- Hub card identification (most versatile cards per color)
- Price movement detection and value pick recommendations

**Card Comparison:**
- Side-by-side mechanical comparison with context-aware ranking
- "In YOUR deck, Card A is better because..." reasoning

### 6.6 AI Context Injection Pattern
Instead of dumping all cards into the prompt, the AI:
1. Receives user question
2. Reasons about what data it needs (using game knowledge)
3. Generates targeted Cypher queries to extract relevant subgraph
4. Receives structured graph data (nodes + edges + properties)
5. Reasons over the subgraph to produce a grounded response

This reduces token usage by ~80% compared to full card list injection.

### 6.7 AI Grounding Rules
- NEVER recommend a card that doesn't exist in Neo4j
- NEVER invent card effects — always read ability text from graph data
- ALWAYS cite card ID + name when making recommendations
- ALWAYS explain reasoning using game mechanics, not vague statements
- If unsure about an interaction, say so rather than guessing
- If graph data is incomplete (missing cards or edges), acknowledge the limitation

---

## 7. AI Agent Architecture

### 7.1 Dual-Provider Design

The agent supports two AI providers. The user can switch between them in the frontend settings panel.

```
┌─────────────────────────────────────────────────────┐
│                 LLM Provider Layer                   │
│                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │   Claude (Direct)    │  │     OpenRouter        │  │
│  │                      │  │                       │  │
│  │  • Anthropic API     │  │  • Unified gateway    │  │
│  │  • Lowest latency    │  │  • 300+ models        │  │
│  │  • Full features     │  │  • GPT, Gemini, Llama │  │
│  │  • Default provider  │  │  • User-selectable    │  │
│  │                      │  │  • OpenAI-compatible   │  │
│  │  Base URL:           │  │    tool format         │  │
│  │  api.anthropic.com   │  │                       │  │
│  │                      │  │  Base URL:            │  │
│  │  Models:             │  │  openrouter.ai/api    │  │
│  │  claude-sonnet-4-*   │  │                       │  │
│  │  claude-opus-4-*     │  │  Models:              │  │
│  │                      │  │  (any with tool use)  │  │
│  └──────────────────────┘  └──────────────────────┘  │
│                                                      │
│  Unified Interface:                                  │
│  Both use OpenAI-compatible tool calling schema.     │
│  Anthropic SDK auto-converts internally.             │
│  OpenRouter auto-transforms for each provider.       │
└─────────────────────────────────────────────────────┘
```

**Why keep Claude direct instead of routing everything through OpenRouter:**
- Claude direct via Anthropic API has lowest latency (no proxy hop)
- Anthropic API supports newest features first (extended thinking, structured outputs)
- Claude has highest tool-use accuracy — critical for the "100% accuracy" requirement
- OpenRouter adds value when user wants model variety or cost optimization

### 7.2 Model Capability Tiers

Not all models handle tool use equally well. The agent adjusts its behavior based on model capability to maintain accuracy.

| Tier | Models | Agent Behavior |
|------|--------|---------------|
| **Tier 1: Full Agent** | Claude Sonnet/Opus, GPT-4o, Gemini Pro | Dynamic Cypher generation, multi-step reasoning, multi-hop graph traversal, proactive suggestions |
| **Tier 2: Basic Agent** | Gemini Flash, Llama 3.1 70B+, Mistral Large | Pre-built Cypher query templates only (no dynamic generation), single-step reasoning, max 2 tools per turn |
| **Tier 3: Chat Only** | Small/fast models, Llama 8B, Phi | No tool use. Agent pre-fetches relevant data and injects into prompt. Conversational responses only |

**Tier detection:** On model switch, backend checks the model's supported_parameters from OpenRouter's Models API. If `tools` is not supported → Tier 3. If supported but model is known to have weak tool use → Tier 2. Otherwise → Tier 1.

### 7.3 Agentic Loop

The core agent loop is a simple Python while loop — no framework needed.

```python
async def run_agent(
    user_message: str,
    session: Session,
    provider: LLMProvider,      # Claude or OpenRouter
    neo4j_driver: AsyncDriver,
    ag_ui_emitter: AGUIEmitter
):
    # Inject conversation history from session memory
    messages = session.get_messages()
    messages.append({"role": "user", "content": user_message})

    # System prompt includes game rules + agent instructions
    system = build_system_prompt(session.current_deck, session.selected_leader)

    # Emit AG-UI lifecycle event
    await ag_ui_emitter.emit("RUN_STARTED")

    while True:
        # Call LLM (Claude direct or OpenRouter)
        response = await provider.chat(
            system=system,
            messages=messages,
            tools=AGENT_TOOLS
        )

        # Append assistant response to history
        messages.append({"role": "assistant", "content": response.content})

        # Check if agent wants to use tools
        if response.stop_reason != "tool_use":
            break  # Agent is done, has final text response

        # Execute all tool calls
        tool_results = []
        for tool_call in response.tool_calls:
            await ag_ui_emitter.emit("STEP_STARTED", {"tool": tool_call.name})

            result = await execute_tool(tool_call, neo4j_driver)
            tool_results.append(result)

            # Emit AG-UI state update for UI manipulation
            if tool_call.name == "update_ui_state":
                await ag_ui_emitter.emit("STATE_SNAPSHOT", result.ui_state)

            await ag_ui_emitter.emit("STEP_FINISHED", {"tool": tool_call.name})

        # Feed tool results back to LLM
        messages.append({"role": "user", "content": tool_results})

    # Save conversation to session memory
    session.save_messages(messages)

    # Emit final response via AG-UI
    await ag_ui_emitter.emit("TEXT_MESSAGE", response.text)

    # Proactive suggestions (if Tier 1 model)
    if provider.tier == 1 and session.current_deck:
        suggestions = await generate_proactive_suggestions(session, neo4j_driver)
        await ag_ui_emitter.emit("CUSTOM_EVENT", {"type": "suggestions", "data": suggestions})

    await ag_ui_emitter.emit("RUN_FINISHED")
```

### 7.4 Agent Tools

Tools are defined once using OpenAI-compatible schema. Works for both Claude (auto-converted by Anthropic SDK) and OpenRouter (auto-transformed for each provider).

```python
AGENT_TOOLS = [
    {
        "name": "query_neo4j",
        "description": "Execute a Cypher query against the OPTCG knowledge graph. Use this for any card data retrieval, synergy lookups, or graph traversal. Returns structured JSON results.",
        "parameters": {
            "type": "object",
            "properties": {
                "cypher": {"type": "string", "description": "Valid Cypher query to execute"},
                "params": {"type": "object", "description": "Query parameters (optional)"}
            },
            "required": ["cypher"]
        }
    },
    {
        "name": "get_card",
        "description": "Get full details for a specific card by ID. Returns all properties including ability text, parsed keywords, pricing, and image URLs.",
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {"type": "string", "description": "Card ID, e.g. 'OP03-070'"}
            },
            "required": ["card_id"]
        }
    },
    {
        "name": "find_synergies",
        "description": "Find all cards that synergize with a given card. Returns synergy partners with relationship details (shared families, shared keywords, synergy weight).",
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {"type": "string"},
                "max_hops": {"type": "integer", "default": 1, "description": "1 = direct synergy, 2 = 2-hop network"},
                "color_filter": {"type": "string", "description": "Filter by color (optional)"}
            },
            "required": ["card_id"]
        }
    },
    {
        "name": "find_counters",
        "description": "Find cards that counter a specific card or strategy. Analyzes the threat and returns cards with counter capabilities.",
        "parameters": {
            "type": "object",
            "properties": {
                "target_card_id": {"type": "string", "description": "Card to counter"},
                "user_color": {"type": "string", "description": "User's deck color for filtering relevant counters"}
            },
            "required": ["target_card_id"]
        }
    },
    {
        "name": "get_mana_curve",
        "description": "Get the cost distribution for a set of cards or an archetype. Returns card count per cost level.",
        "parameters": {
            "type": "object",
            "properties": {
                "card_ids": {"type": "array", "items": {"type": "string"}, "description": "List of card IDs to analyze"},
                "archetype": {"type": "string", "description": "Or specify archetype name instead of card_ids"}
            }
        }
    },
    {
        "name": "build_deck_shell",
        "description": "Generate an initial deck skeleton for a given Leader. Returns a 50-card deck list with cost curve, organized by role (attackers, removal, draw, counters).",
        "parameters": {
            "type": "object",
            "properties": {
                "leader_id": {"type": "string", "description": "Leader card ID"},
                "budget_max": {"type": "number", "description": "Max total deck price in USD (optional)"},
                "strategy": {"type": "string", "enum": ["aggro", "midrange", "control"], "description": "Preferred strategy (optional)"}
            },
            "required": ["leader_id"]
        }
    },
    {
        "name": "update_ui_state",
        "description": "Send UI commands to the frontend to manipulate the visual interface. Use this to highlight cards on the graph, show card details, display comparisons, animate synergy paths, or update the deck builder.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "highlight_nodes",
                        "show_card_detail",
                        "show_comparison",
                        "animate_synergy_path",
                        "update_deck_list",
                        "show_mana_curve",
                        "focus_subgraph",
                        "clear_highlights"
                    ]
                },
                "payload": {
                    "type": "object",
                    "description": "Action-specific data. For highlight_nodes: {card_ids: [...]}. For show_comparison: {cards: [id1, id2]}. For update_deck_list: {cards: [...], leader: id}. For animate_synergy_path: {from: id, to: id, path: [...]}."
                }
            },
            "required": ["action", "payload"]
        }
    }
]
```

### 7.5 AG-UI Event Flow

AG-UI is the transport layer between agent and frontend. The agent emits events, the frontend (via CopilotKit) reacts.

**Event mapping for OPTCG use cases:**

| Agent Action | AG-UI Event | Frontend Reaction |
|-------------|-------------|-------------------|
| Agent starts processing | `RUN_STARTED` | Show loading spinner in chat |
| Agent querying Neo4j | `STEP_STARTED` | Show "Searching knowledge graph..." |
| Agent streaming text response | `TEXT_MESSAGE_CONTENT` | Stream text into chat bubble |
| Agent found synergy partners | `STATE_SNAPSHOT` | Highlight nodes on D3 graph, update synergy panel |
| Agent built deck list | `STATE_SNAPSHOT` | Populate deck builder UI with cards |
| Agent comparing cards | `TOOL_CALL` result | Open side-by-side comparison panel |
| Agent highlighting path | `CUSTOM_EVENT` | Animate synergy path on D3 graph |
| Agent finished | `RUN_FINISHED` | Remove loading, show proactive suggestions |
| Agent error | `RUN_ERROR` | Show error message in chat |

**AG-UI Shared State object:**
```typescript
interface OPTCGAgentState {
  // Current deck being built
  currentDeck: {
    leader: Card | null;
    cards: Card[];
    totalCost: number;
  };
  // Graph visualization state
  graphState: {
    highlightedNodes: string[];     // Card IDs to highlight
    focusedSubgraph: string | null; // Subgraph to zoom into
    animatedPaths: SynergyPath[];   // Paths to animate
  };
  // UI panel state
  panels: {
    cardDetail: Card | null;       // Card to show in detail panel
    comparison: Card[];             // Cards in comparison view
    manaCurve: CurveData | null;   // Mana curve chart data
  };
  // Agent suggestions
  suggestions: string[];            // Proactive suggestion prompts
  // Selected model
  modelConfig: {
    provider: "claude" | "openrouter";
    model: string;
    tier: 1 | 2 | 3;
  };
}
```

### 7.6 Session Memory

Multi-turn conversation memory enables context-aware interactions. User can build a deck across multiple messages without repeating context.

**Memory strategy:**

| Storage | Data | TTL |
|---------|------|-----|
| **In-memory (per request)** | Current messages array for agentic loop | Request lifetime |
| **Redis (per session)** | Conversation history, current deck state, selected Leader, model preference | 24 hours (configurable) |
| **Neo4j (persistent)** | Saved deck lists, user preferences (future feature) | Permanent |

**Session flow:**
```
Turn 1: "Build me a Purple Luffy deck"
  → Agent creates session, sets leader = ST13-003, builds initial shell
  → Session saved to Redis: {leader, deck_cards, messages}

Turn 2: "I need more removal options"
  → Agent loads session from Redis, knows leader and current deck
  → Queries graph for removal cards compatible with current build
  → Updates deck list in session

Turn 3: "Replace Kaku with something cheaper"
  → Agent knows Kaku is in the deck (from session)
  → Finds budget alternatives with similar function
  → Updates deck list, emits AG-UI state update to frontend

Turn 4: "What's the total price?"
  → Agent reads deck from session, sums market_price from graph
  → Responds with breakdown
```

### 7.7 Proactive Suggestions

After each response, the agent (Tier 1 models only) analyzes the session state and generates proactive suggestions. These appear as clickable chips below the chat.

**Suggestion triggers:**

| Condition | Suggestion |
|-----------|------------|
| Deck has < 50 cards | "Want me to fill the remaining {n} slots?" |
| Mana curve has gap at cost 3 | "Your curve is light at 3-cost. Want me to suggest options?" |
| No Blocker cards in deck | "You have no Blockers. Vulnerable to Rush attacks?" |
| No counter values in deck | "Counter density is low. Want to add defensive options?" |
| High-value card has budget alternative | "OP05-060 ($12) could be replaced with OP03-057 ($0.50) — similar effect" |
| New set released (detected via crawl) | "New cards from OP14 are available. Want me to check for upgrades?" |
| Session idle > 2 minutes with incomplete deck | "Ready to finalize your deck list?" |

### 7.8 LLM Provider Abstraction

A thin adapter layer normalizes the interface between Claude and OpenRouter.

```python
class LLMProvider(Protocol):
    """Unified interface for all LLM providers"""

    async def chat(
        self,
        system: str,
        messages: list[dict],
        tools: list[dict],
        stream: bool = True
    ) -> LLMResponse: ...

    @property
    def tier(self) -> int: ...
    @property
    def model_name(self) -> str: ...


class ClaudeProvider(LLMProvider):
    """Direct Anthropic API — lowest latency, highest accuracy"""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = model

    async def chat(self, system, messages, tools, stream=True):
        # Uses Anthropic SDK which auto-converts OpenAI tool format
        response = await self.client.messages.create(
            model=self.model,
            system=system,
            messages=messages,
            tools=convert_to_anthropic_tools(tools),
            max_tokens=4096
        )
        return normalize_response(response)

    @property
    def tier(self) -> int:
        return 1  # Claude is always Tier 1


class OpenRouterProvider(LLMProvider):
    """OpenRouter gateway — 300+ models, user-selectable"""

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self._tier = self._detect_tier(model)

    async def chat(self, system, messages, tools, stream=True):
        # OpenRouter uses OpenAI-compatible format natively
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [{"role": "system", "content": system}] + messages,
                    "tools": tools if self._tier >= 2 else None,
                    "stream": stream
                }
            )
        return normalize_response(response.json())

    def _detect_tier(self, model: str) -> int:
        TIER_1_MODELS = ["openai/gpt-4o", "google/gemini-pro", "anthropic/claude"]
        TIER_2_MODELS = ["google/gemini-flash", "meta-llama/llama-3.1-70b"]
        if any(t in model for t in TIER_1_MODELS): return 1
        if any(t in model for t in TIER_2_MODELS): return 2
        return 3
```

---

## 8. Graph Query Engine

### 7.1 Core Cypher Query Patterns

**Deck Building:**
```cypher
// Find all synergy partners for a Leader
MATCH (l:Card {id: $leader_id})-[:BELONGS_TO]->(f:Family)<-[:BELONGS_TO]-(partner:Card)
WHERE partner.card_type IN ['CHARACTER', 'EVENT', 'STAGE']
AND (l)-[:HAS_COLOR]->(:Color)<-[:HAS_COLOR]-(partner)
RETURN partner, collect(f.name) AS shared_families
ORDER BY size(collect(f.name)) DESC

// Optimal mana curve for an archetype
MATCH (c:Card)-[:PART_OF_ARCHETYPE]->(:Archetype {name: $archetype})
RETURN c.cost AS cost, collect(c) AS cards
ORDER BY cost

// Counter picks against a meta deck
MATCH (threat:Card)-[:PART_OF_ARCHETYPE]->(:Archetype {name: $target})
MATCH (counter:Card)-[:COUNTERS]->(threat)
RETURN counter, count(threat) AS threats_countered
ORDER BY threats_countered DESC
```

**Card Evaluation:**
```cypher
// Synergy count for a card
MATCH (c:Card {id: $card_id})-[r:SYNERGY|MECHANICAL_SYNERGY]-(partner)
RETURN count(r) AS synergy_count, collect(partner.name) AS partners

// Multi-hop synergy network
MATCH path = (c:Card {id: $card_id})-[:SYNERGY*1..2]-(partner)
RETURN path

// Value picks: high connectivity, low price
MATCH (c:Card)-[:HAS_COLOR]->(:Color {name: $color})
WHERE c.market_price <= $max_price
WITH c, size((c)-[:SYNERGY|MECHANICAL_SYNERGY]-()) AS connections
WHERE connections >= $min_connections
RETURN c, connections
ORDER BY connections DESC
```

**Meta Analysis:**
```cypher
// Hub cards (most connected)
MATCH (c:Card)-[:HAS_COLOR]->(:Color {name: $color})
WITH c, size((c)-[:SYNERGY|MECHANICAL_SYNERGY]-()) AS degree
RETURN c, degree
ORDER BY degree DESC
LIMIT $top_n

// Price movement detection
MATCH (c:Card)
WHERE c.market_price > c.market_price_yesterday * 1.1
RETURN c, c.market_price, c.market_price_yesterday,
       (c.market_price - c.market_price_yesterday) / c.market_price_yesterday AS pct_change
ORDER BY pct_change DESC
```

### 8.2 Backend API Endpoints (FastAPI)

```
# Graph queries
GET  /api/graph/card/{card_id}                     → Card node + all edges
GET  /api/graph/card/{card_id}/synergies            → Synergy partners
GET  /api/graph/card/{card_id}/network?hops=2       → N-hop subgraph
GET  /api/graph/leader/{leader_id}/deck-candidates  → Deck building suggestions
GET  /api/graph/archetype/{name}/core-cards         → Archetype staples
GET  /api/graph/query/counters?against={archetype}  → Counter picks
GET  /api/graph/query/curve?color={c}&family={f}    → Mana curve
GET  /api/graph/stats/hubs?color={c}&top={n}        → Most connected cards
GET  /api/graph/search?keyword={kw}&cost_max={n}    → Filtered search

# AI agent (AG-UI SSE stream)
POST /api/ai/chat                                   → AG-UI event stream (main agent endpoint)

# Settings
GET  /api/settings/models                           → Available models list (Claude + OpenRouter)
PUT  /api/settings/model                             → Switch active model

# Data management
POST /api/data/crawl                                → Trigger full crawl pipeline
POST /api/data/update-prices                        → Update pricing only
GET  /api/data/stats                                → DB stats
```

---

## 9. Implementation Phases

### Phase 1: Project Setup & Data Foundation (Week 1)
- [ ] Initialize project with `uv init`, configure `pyproject.toml`
- [ ] `uv add httpx neo4j python-dotenv anthropic pydantic fastapi uvicorn`
- [ ] Set up Neo4j Community Edition via Docker (`docker compose up -d`)
- [ ] Write crawl script for apitcg.com (paginated, respects rate limits)
- [ ] Write crawl script for optcgapi.com (bulk endpoints, 1-2s delay)
- [ ] Build merge logic: join on card ID, handle conflicts
- [ ] Load merged data into Neo4j (create Card nodes with all properties)
- [ ] Create Color, Family, Set nodes and property edges
- [ ] Validate data completeness: compare card counts against known set sizes
- [ ] Create indexes on Card nodes

### Phase 2: Ability Parser + Keyword Graph (Week 2)
- [ ] Design LLM prompt for structured ability parsing
- [ ] Build batch processing pipeline (10-20 abilities per Claude API call)
- [ ] Parse all ~3000 card abilities
- [ ] Validate parser output against manually labeled sample (50-100 cards)
- [ ] Create Keyword nodes and HAS_KEYWORD edges in Neo4j
- [ ] Create CostTier nodes and IN_COST_TIER edges

### Phase 3: Synergy & Strategic Edges (Week 3)
- [ ] Implement auto-computed SYNERGY edges (shared family within same color)
- [ ] Implement auto-computed MECHANICAL_SYNERGY edges (shared keywords ≥ 2)
- [ ] Implement CURVES_INTO edges (cost progression within archetype)
- [ ] Implement LLM-derived COUNTERS edges
- [ ] Implement LLM-derived SEARCHES_FOR edges
- [ ] Implement LLM-derived TRIGGERS edges
- [ ] Validate edge quality: manual review of 100 random synergy edges

### Phase 4: Backend API (Week 4)
- [ ] FastAPI app with Neo4j driver connection pool
- [ ] Implement all graph query endpoints (Section 7.2)
- [ ] Pydantic request/response models
- [ ] Error handling, pagination, caching
- [ ] Auto-generated API docs (Swagger/OpenAPI)

### Phase 5: AI Agent Runtime (Week 5)
- [ ] Implement LLM provider abstraction (ClaudeProvider + OpenRouterProvider)
- [ ] Implement model tier detection system
- [ ] Build core agentic loop with tool execution
- [ ] Implement all 7 agent tools (query_neo4j, get_card, find_synergies, find_counters, get_mana_curve, build_deck_shell, update_ui_state)
- [ ] Set up Redis for session memory
- [ ] Implement session management (save/load conversation, current deck state)
- [ ] Implement proactive suggestion generator
- [ ] Test agentic loop with Claude (Tier 1) end-to-end
- [ ] Test with OpenRouter models (Tier 2, Tier 3 fallback behavior)

### Phase 6: AG-UI Integration (Week 6)
- [ ] Set up AG-UI adapter in FastAPI (SSE event streaming)
- [ ] Implement AG-UI event emitter (RUN_STARTED, STEP_STARTED, TEXT_MESSAGE, STATE_SNAPSHOT, etc.)
- [ ] Implement shared state object (OPTCGAgentState)
- [ ] Wire update_ui_state tool to AG-UI events
- [ ] Test event flow: agent action → AG-UI event → frontend reaction

### Phase 7: Frontend (Week 7-8)
- [ ] `npm create vite@latest frontend -- --template react-ts`
- [ ] Install and configure Tailwind CSS v4
- [ ] Install CopilotKit (@copilotkit/react-core, @copilotkit/react-ui)
- [ ] Install D3.js for graph visualization
- [ ] Build AI chat interface with CopilotKit (AG-UI consumer)
- [ ] Build graph explorer page (D3 force-directed, responds to AG-UI highlight/animate events)
- [ ] Build card detail panel (triggered by AG-UI show_card_detail)
- [ ] Build card comparison panel (triggered by AG-UI show_comparison)
- [ ] Build deck builder UI (populated by AG-UI update_deck_list)
- [ ] Build mana curve visualization (triggered by AG-UI show_mana_curve)
- [ ] Build model selector / settings panel (switch Claude ↔ OpenRouter models)
- [ ] Build proactive suggestion chips (rendered from AG-UI CUSTOM_EVENT)
- [ ] Connect all components to AG-UI shared state

### Phase 8: Polish & Data Maintenance (Week 9)
- [ ] Weekly price update cron job (optcgapi only)
- [ ] New set ingestion pipeline (crawl → parse → rebuild edges)
- [ ] Archetype detection and labeling (semi-automated with LLM)
- [ ] Performance optimization (Neo4j query tuning, API response caching)
- [ ] Error monitoring and logging

---

## 10. Crawl Script Specifications

### 9.1 apitcg.com Crawler

```
Rate limit: 1000 requests/month (free plan)
Expected usage per full crawl: ~130 requests
Strategy: Paginate through /api/one-piece/cards, 25 per page
Headers: API key in request headers
Error handling: Retry with exponential backoff on 429/500
Delay: 1 second between requests
Output: JSON dump + direct Neo4j insert
```

### 9.2 optcgapi.com Crawler

```
Rate limit: No hard limit (be respectful)
Strategy: Hit bulk endpoints first (/api/allSetCards/, /api/allSTCards/, /api/allPromoCards/)
         Then individual card endpoints only for missing data
Delay: 1.5 seconds between requests
Error handling: Retry 3x with 5s backoff
Output: JSON dump + Neo4j merge on card ID
```

### 9.3 Incremental Update Strategy

```
Frequency: Weekly for pricing, on-demand when a new set releases
Pricing update: optcgapi only, ~200 requests
New set update: apitcg filter by set, ~5-10 requests per new set
Process: Update Card node properties in Neo4j, rebuild affected synergy edges
```

---

## 11. Success Metrics

| Metric | Target |
|--------|--------|
| Card coverage | 100% of English OPTCG cards (OP01-OP14 + STs + Promos) |
| Graph query latency | < 50ms for single-card Cypher queries, < 200ms for 2-hop traversal |
| Ability parser accuracy | > 90% keyword extraction accuracy (validated on 100-card sample) |
| Synergy edge quality | Manual review: > 85% of SYNERGY edges are gameplay-relevant |
| AI deck suggestion quality | AI-suggested decks share ≥ 70% overlap with known meta lists |
| Agent context reduction | 80%+ reduction in tokens vs full card list dump |
| Crawl reliability | Zero failed crawls due to rate limiting |
| Frontend load time | < 2s initial load, < 500ms graph interaction response |

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API rate limit exceeded | Crawl fails | Budget tracking; crawl once + cache in Neo4j |
| API goes offline permanently | No data source | Neo4j is the source of truth after initial crawl |
| Ability text inconsistencies across sets | Parser accuracy drops | LLM parser handles ambiguity; add few-shot examples per set |
| Multi-color cards complicate graph | Wrong synergy edges | Each color is a separate HAS_COLOR edge; multi-color cards get multiple edges |
| Meta shifts faster than graph updates | Stale recommendations | Weekly re-crawl for pricing; archetype edges reviewed monthly |
| apitcg.com requires paid plan later | Budget impact | Neo4j already has all data after initial crawl; optcgapi is free fallback |
| Neo4j learning curve | Slower initial development | Community Edition has excellent docs; Cypher is intuitive for graph queries |
| AI hallucinations in deck suggestions | Bad recommendations | All AI responses grounded in actual graph data; never recommend cards not in the graph |

---

## 13. File Structure

```
optcg-knowledge-graph/
├── README.md
├── pyproject.toml                # uv project config + dependencies
├── uv.lock                      # uv lockfile
├── .env                          # API keys (gitignored)
├── .gitignore
│
├── backend/
│   ├── __init__.py
│   ├── config.py                 # Environment vars, Neo4j/Redis connection settings
│   ├── main.py                   # FastAPI app entry point + AG-UI adapter
│   │
│   ├── crawlers/
│   │   ├── __init__.py
│   │   ├── apitcg.py             # apitcg.com paginated crawler
│   │   ├── optcgapi.py           # optcgapi.com bulk crawler
│   │   └── merge.py              # Merge logic, Neo4j loader
│   │
│   ├── parser/
│   │   ├── __init__.py
│   │   ├── ability_parser.py     # LLM-based ability text parser
│   │   ├── prompts.py            # Claude API prompts for parsing
│   │   └── keywords.py           # Known OPTCG keyword taxonomy
│   │
│   ├── graph/
│   │   ├── __init__.py
│   │   ├── connection.py         # Neo4j driver + connection pool
│   │   ├── builder.py            # Build nodes and edges in Neo4j
│   │   ├── edges.py              # Synergy, counter, trigger edge computation
│   │   └── queries.py            # Reusable Cypher query functions
│   │
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── loop.py               # Core agentic loop (while tool_use)
│   │   ├── tools.py              # Tool definitions (OpenAI-compatible schema)
│   │   ├── tool_executor.py      # Tool execution logic (Neo4j queries, UI state)
│   │   ├── providers.py          # LLM provider abstraction (Claude + OpenRouter)
│   │   ├── tiers.py              # Model capability tier detection + behavior adjustment
│   │   ├── session.py            # Session memory management (Redis/SQLite)
│   │   ├── suggestions.py        # Proactive suggestion generator
│   │   └── ag_ui.py              # AG-UI event emitter + state management
│   │
│   ├── ai/
│   │   ├── __init__.py
│   │   ├── deck_builder.py       # Deck building AI logic
│   │   ├── card_analyzer.py      # Card analysis AI logic
│   │   ├── counter_advisor.py    # Counter-play analysis logic
│   │   ├── game_rules.py         # OPTCG rules & strategy as system prompt
│   │   └── prompts.py            # System prompts for AI features
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes_graph.py       # Graph query endpoints
│   │   ├── routes_ai.py          # AI feature endpoints (AG-UI SSE stream)
│   │   ├── routes_data.py        # Data management endpoints
│   │   ├── routes_settings.py    # Model selection, user preferences
│   │   └── models.py             # Pydantic request/response models
│   │
│   └── scripts/
│       ├── full_crawl.py         # Run complete crawl + load pipeline
│       ├── update_prices.py      # Weekly price update
│       ├── rebuild_edges.py      # Rebuild computed edges
│       └── parse_abilities.py    # Run ability parser on all cards
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── GraphExplorer.tsx  # D3 force-directed graph
│       │   ├── CardDetail.tsx     # Card info + synergy panel
│       │   ├── DeckBuilder.tsx    # Deck building UI
│       │   ├── CardComparison.tsx # Side-by-side card comparison
│       │   ├── ManaCurve.tsx      # Mana curve visualization
│       │   ├── AIChat.tsx         # CopilotKit AI chat interface
│       │   ├── ModelSelector.tsx  # LLM provider/model picker
│       │   ├── Suggestions.tsx    # Proactive suggestion chips
│       │   └── ui/               # Shared UI components
│       ├── hooks/
│       │   ├── useGraph.ts       # Graph data fetching
│       │   ├── useAGUI.ts        # AG-UI event handling via CopilotKit
│       │   ├── useAgentState.ts  # Shared agent state management
│       │   └── useSession.ts     # Session/conversation management
│       ├── lib/
│       │   ├── api.ts            # API client
│       │   ├── graph.ts          # D3 graph helpers
│       │   └── agui.ts           # AG-UI event type definitions
│       └── types/
│           ├── index.ts          # General TypeScript type definitions
│           └── agent.ts          # Agent state, event, tool types
│
├── docker-compose.yml            # Neo4j + Redis + backend services
│
└── tests/
    ├── test_crawler.py
    ├── test_parser.py
    ├── test_graph_queries.py
    ├── test_agent_loop.py
    ├── test_providers.py
    └── test_ag_ui.py
```

---

## 14. Environment Setup

### 14.1 Prerequisites
- Python 3.12+ (managed via uv)
- Node.js 20+ (for frontend)
- Docker (for Neo4j + Redis)

### 14.2 Backend Setup

```bash
# Install uv (if not installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Initialize project
uv init optcg-knowledge-graph
cd optcg-knowledge-graph

# Add dependencies
uv add httpx neo4j python-dotenv anthropic pydantic fastapi uvicorn redis

# Create .env file
cat > .env << EOF
# LLM Providers
ANTHROPIC_API_KEY=your_anthropic_key_here
OPENROUTER_API_KEY=your_openrouter_key_here

# Data Sources
APITCG_API_KEY=your_apitcg_key_here

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password

# Redis (session memory)
REDIS_URL=redis://localhost:6379

# Default AI Model
DEFAULT_PROVIDER=claude
DEFAULT_MODEL=claude-sonnet-4-20250514
EOF
```

### 14.3 Neo4j + Redis Setup (Docker)

```yaml
# docker-compose.yml
services:
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"   # Browser UI
      - "7687:7687"   # Bolt protocol
    environment:
      - NEO4J_AUTH=neo4j/your_neo4j_password
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  neo4j_data:
  neo4j_logs:
  redis_data:
```

```bash
docker compose up -d
# Neo4j Browser: http://localhost:7474
# Redis: localhost:6379
```

### 14.4 Frontend Setup

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install d3 @types/d3
npm install tailwindcss @tailwindcss/vite       # Tailwind v4
npm install @copilotkit/react-core               # CopilotKit AG-UI client
npm install @copilotkit/react-ui                 # CopilotKit UI components
```

### 13.5 .gitignore

```
.env
node_modules/
__pycache__/
*.pyc
dist/
.vite/
neo4j_data/
neo4j_logs/
```

---

## 15. Claude Code Handoff Notes

When Claude Code receives this PRD, follow the implementation order by Phase (Section 9). Key notes:

1. **Use `uv` for all Python operations.** `uv add` to install packages, `uv run` to execute scripts. Do not use pip.

2. **Neo4j from the start.** Do not build an intermediate SQLite layer. Crawl data goes directly into Neo4j. The graph database IS the source of truth.

3. **Crawl first, build later.** Do not build synergy edges without real data. Phase 1 must complete before Phase 3.

4. **The ability parser is the hardest piece.** Invest time in prompt engineering. Test on edge cases: multi-effect cards, DON!! conditions, cards with On Play + When Attacking + Blocker combined.

5. **Start simple with edges.** Phase 3 begins with auto-computed SYNERGY and MECHANICAL_SYNERGY. LLM-derived edges (COUNTERS, SEARCHES_FOR, TRIGGERS) come after basic edges are validated.

6. **API key security.** Load all secrets from `.env` via `python-dotenv`. Never hardcode keys. See Section 14 for setup.

7. **AI must be grounded.** Every AI response must be backed by actual Neo4j query results. If the AI suggests a card, that card must exist in the graph with real synergy edges. No hallucinated recommendations.

8. **Dual LLM providers.** Claude is default (direct Anthropic API). OpenRouter is secondary (user-selectable). Both use OpenAI-compatible tool schema. See Section 7.1 and 7.8 for provider abstraction.

9. **AG-UI for agent↔frontend communication.** Do not build custom WebSocket handlers. Use AG-UI protocol with CopilotKit React SDK. The `update_ui_state` tool is how the agent manipulates the frontend. See Section 7.5.

10. **Frontend uses Vite + Tailwind v4 + CopilotKit + D3.** Do not use Create React App or Webpack. CopilotKit handles AG-UI event consumption. D3 handles graph rendering. Tailwind v4 for styling.

11. **Session memory via Redis.** Multi-turn conversations persist in Redis with 24h TTL. Agent must load session before each turn and save after. See Section 7.6.

12. **Model tier system.** When user switches models via OpenRouter, detect capability tier and adjust agent behavior. Tier 1 = full agent. Tier 2 = template queries only. Tier 3 = no tools. See Section 7.2.

13. **Test with real deck building.** Final validation: have the AI build a Purple Luffy deck via the chat UI. Verify that the agent highlights cards on the graph, populates the deck builder, and shows mana curve — all via AG-UI events. Compare deck output against community-known meta decks on limitlesstcg.com.

14. **Docker for infrastructure.** Use the provided docker-compose.yml for Neo4j + Redis. Neo4j Browser at localhost:7474 is invaluable for debugging graph data during development.
