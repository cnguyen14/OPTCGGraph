# API Documentation

REST API endpoint documentation for the OPTCG Knowledge Graph backend.

See `OPTCG-Knowledge-Graph-PRD-EN.md` section 8.2 for the full endpoint list.

## Auto-Generated Docs
Once the FastAPI backend is running, interactive API docs are available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Endpoint Groups
- `/api/graph/` — Graph query endpoints
- `/api/ai/` — AI agent endpoints (AG-UI SSE stream)
- `/api/settings/` — Model selection and preferences
- `/api/data/` — Data management (crawl, update prices)
