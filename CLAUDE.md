# CLAUDE.md

## CRITICAL: Code Navigation Rules

**ALWAYS use GitNexus MCP tools for code navigation. NEVER use manual Grep/Read as first approach.**

| Instead of | Use |
|------------|-----|
| `Grep` to find code | `gitnexus_query({query: "concept"})` |
| `Read` to understand a function | `gitnexus_context({name: "funcName", include_content: true})` |
| `Grep` to check what calls X | `gitnexus_context({name: "X"})` → incoming refs |
| `Read` multiple files to trace flow | `gitnexus_query` → process results |
| Edit without checking impact | `gitnexus_impact({target: "X"})` FIRST |

**Only fall back to Grep/Read when:** GitNexus index is stale, symbol not found, or need to read non-code files (configs, .env, package.json).

This saves tokens and provides richer context (callers, callees, execution flows) in a single call.

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
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **OPTCGGraph** (2704 symbols, 7836 relationships, 228 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/OPTCGGraph/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/OPTCGGraph/context` | Codebase overview, check index freshness |
| `gitnexus://repo/OPTCGGraph/clusters` | All functional areas |
| `gitnexus://repo/OPTCGGraph/processes` | All execution flows |
| `gitnexus://repo/OPTCGGraph/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
