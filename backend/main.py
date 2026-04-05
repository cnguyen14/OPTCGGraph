"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.core.exceptions import OPTCGError

from backend.graph.connection import get_driver, close_driver
from backend.storage.redis_client import get_redis, close_redis, verify_redis
from backend.api.routes_graph import router as graph_router
from backend.api.routes_data import router as data_router
from backend.api.routes_settings import router as settings_router
from backend.api.routes_ai import router as ai_router
from backend.api.routes_deck import router as deck_router
from backend.api.routes_meta import router as meta_router
from backend.api.routes_simulator import router as simulator_router
from backend.services.settings_service import load_persisted_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verify Neo4j + Redis connections
    driver = await get_driver()
    await driver.verify_connectivity()
    r = await get_redis()
    await r.ping()
    # Restore persisted settings (API keys, model config)
    await load_persisted_settings()
    yield
    # Shutdown: close connections
    await close_redis()
    await close_driver()


app = FastAPI(
    title="OPTCG Knowledge Graph API",
    description="AI-powered One Piece TCG deck building platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler for application errors
@app.exception_handler(OPTCGError)
async def optcg_error_handler(request: Request, exc: OPTCGError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


# Serve local card images
_images_dir = Path("data/card_images")
if _images_dir.exists():
    app.mount("/api/images", StaticFiles(directory=str(_images_dir)), name="card_images")

# Mount routers
app.include_router(graph_router)
app.include_router(data_router)
app.include_router(settings_router)
app.include_router(ai_router)
app.include_router(deck_router)
app.include_router(meta_router)
app.include_router(simulator_router)


@app.get("/")
async def root():
    return {"name": "OPTCG Knowledge Graph API", "version": "0.1.0"}


@app.get("/health")
async def health():
    from backend.graph.connection import verify_connection
    neo4j_ok = await verify_connection()
    redis_ok = await verify_redis()
    all_ok = neo4j_ok and redis_ok
    return {"status": "ok" if all_ok else "degraded", "neo4j": neo4j_ok, "redis": redis_ok}
