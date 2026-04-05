# CLAUDE.md

## Communication

- Always communicate with the user in **Vietnamese** (tiếng Việt).
- Use **English** for code, comments, commit messages, PR descriptions, and all technical artifacts.

## Project Overview

OPTCG Knowledge Graph — AI-powered One Piece TCG deck building platform.
Knowledge Graph (Neo4j) at its core for card synergy analysis and AI-assisted deck building.

**Full PRD:** `OPTCG-Knowledge-Graph-PRD-EN.md`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Package Manager | uv (Python), npm (Frontend) |
| Backend | Python 3.12+, FastAPI, Neo4j (Cypher), Redis, httpx |
| AI / LLM | Claude API (direct, default) + OpenRouter (300+ models) |
| Agent Transport | AG-UI Protocol (SSE streaming via CopilotKit) |
| Frontend | Vite + React 19 + TypeScript (strict), Tailwind CSS v4, D3.js |
| Frontend Agent | CopilotKit (@copilotkit/react-core, @copilotkit/react-ui) |
| Infrastructure | Docker (Neo4j Community 5 + Redis 7) |

## Project Structure

```
backend/                # FastAPI application
  crawlers/             # apitcg + optcgapi crawlers
  parser/               # LLM ability text parser
  graph/                # Neo4j connection, builders, queries
  agent/                # Agentic loop, tools, providers, AG-UI
  ai/                   # Deck builder, card analyzer, prompts
  api/                  # FastAPI routers + Pydantic models
  scripts/              # CLI scripts (crawl, parse, rebuild)
frontend/               # Vite + React application
  src/components/       # React components (GraphExplorer, DeckBuilder, AIChat...)
  src/hooks/            # Custom hooks (useGraph, useAGUI, useAgentState)
  src/lib/              # Utilities, D3 helpers, API client
docs/                   # Documentation
  architecture/         # System design, data flow diagrams
  features/             # Feature explanations
  api/                  # API endpoint documentation
  setup/                # Dev environment setup guides
worklogs/               # Dated progress entries (TEMPLATE.md for format)
.claude/agents/         # Custom subagents for multi-agent workflows
docker-compose.yml      # Neo4j + Redis services
```

## Key Conventions

### Python (Backend)
- **Package manager:** `uv add <pkg>`, `uv run <cmd>`, `uv sync`
- **Linting/formatting:** `uv run ruff check .` / `uv run ruff format .`
- **Type checking:** `uv run mypy .`
- **Testing:** `uv run pytest -v`
- **All I/O is async:** async def, await (httpx, neo4j async driver, FastAPI)
- **Neo4j queries:** Parameterized Cypher only — NEVER use f-string/string interpolation
- **Data models:** Pydantic v2 for all request/response schemas
- **File naming:** snake_case for files, PascalCase for classes

### TypeScript (Frontend)
- **Strict mode**, no `any` types
- **Package manager:** `npm install`, `npm run dev`
- **Components:** PascalCase filenames, functional components with hooks
- **Styling:** Tailwind CSS v4 (CSS-first config, `@theme` directive)
- **Agent integration:** CopilotKit hooks (`useCopilotChat`, `useCopilotAction`)
- **Graph rendering:** D3.js force-directed layout

### Git
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **Feature branches** from main
- **Run test-runner agent** before committing

## Multi-Agent Strategy

Use parallel subagents (`.claude/agents/`) when tasks are independent:

| Phase | Parallel Opportunities |
|-------|----------------------|
| Phase 1: Data Foundation | `data-pipeline` x2 (apitcg crawler + optcgapi crawler in parallel) |
| Phase 3: Edges | Compute SYNERGY, MECHANICAL_SYNERGY, CURVES_INTO edges in parallel |
| Phase 4+5: Backend + AI | Backend API endpoints + AI agent runtime can develop in parallel |
| Phase 7: Frontend | GraphExplorer, DeckBuilder, AIChat components in parallel |
| Always | Run `test-runner` agent after completing any feature |

**Available agents:** `backend-dev`, `frontend-dev`, `data-pipeline`, `test-runner`, `devops`, `code-reviewer`

## Worklog Requirements

**After completing any feature or significant work unit:**
1. Create a file in `worklogs/` named `YYYY-MM-DD-feature-name.md`
2. Follow the template in `worklogs/TEMPLATE.md`
3. This is mandatory — never skip worklog updates

## Documentation Requirements

- **New features:** Add explanation to `docs/features/`
- **API changes:** Update `docs/api/`
- **Architecture decisions:** Document in `docs/architecture/`

## Implementation Phases

| # | Phase | Key Deliverables |
|---|-------|-----------------|
| 1 | Project Setup & Data Foundation | uv init, Docker, crawlers, Neo4j schema, Card nodes |
| 2 | Ability Parser + Keyword Graph | LLM parser, Keyword nodes, HAS_KEYWORD edges |
| 3 | Synergy & Strategic Edges | SYNERGY, MECHANICAL_SYNERGY, COUNTERS, LED_BY edges |
| 4 | Backend API | FastAPI endpoints, Pydantic models, caching |
| 5 | AI Agent Runtime | Agentic loop, 7 tools, Claude + OpenRouter providers, session memory |
| 6 | AG-UI Integration | SSE streaming, shared state, event emitter |
| 7 | Frontend | React + CopilotKit + D3 (GraphExplorer, DeckBuilder, AIChat) |
| 8 | Polish & Maintenance | Cron jobs, performance tuning, error monitoring |

See PRD for detailed task lists per phase.

<!-- gitnexus:start -->
## GitNexus — Code Intelligence

This project is indexed by GitNexus as **OPTCGGraph** (2360 symbols, 6571 relationships, 198 execution flows).
Use GitNexus MCP tools to navigate code, assess impact, and refactor safely. If any tool warns the index is stale, run `npx gitnexus analyze` first.

### Tools Quick Reference

| Tool | When to use | Example |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "simulation runner"})` |
| `context` | 360-degree view of a symbol | `gitnexus_context({name: "LLMAgent"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "GameEngine", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

### Rules

**Always:**
- Run `gitnexus_impact` before editing any function/class/method — report blast radius to the user
- Run `gitnexus_detect_changes()` before committing to verify scope
- Warn the user if impact analysis returns HIGH or CRITICAL risk
- Use `gitnexus_query` instead of grep for exploring unfamiliar code

**Never:**
- Edit a symbol without first running `gitnexus_impact`
- Ignore HIGH or CRITICAL risk warnings
- Rename symbols with find-and-replace — use `gitnexus_rename`

### Workflows

**Debugging:**
1. `gitnexus_query({query: "<error or symptom>"})` — find related execution flows
2. `gitnexus_context({name: "<suspect function>"})` — see callers, callees, process participation
3. `READ gitnexus://repo/OPTCGGraph/process/{processName}` — trace full execution flow
4. Regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})`

**Refactoring:**
- **Rename:** `gitnexus_rename` with `dry_run: true` first, then `dry_run: false`
- **Extract/Split:** `gitnexus_context` → `gitnexus_impact` → move code → `gitnexus_detect_changes`

### Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers | MUST update |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

### Resources

- `gitnexus://repo/OPTCGGraph/context` — Codebase overview, index freshness
- `gitnexus://repo/OPTCGGraph/clusters` — All functional areas
- `gitnexus://repo/OPTCGGraph/processes` — All execution flows
- `gitnexus://repo/OPTCGGraph/process/{name}` — Step-by-step execution trace

### Re-index

```bash
npx gitnexus analyze              # standard re-index
npx gitnexus analyze --embeddings # preserve embeddings (check .gitnexus/meta.json stats.embeddings)
```

> PostToolUse hook handles re-indexing automatically after `git commit` and `git merge`.
<!-- gitnexus:end -->
