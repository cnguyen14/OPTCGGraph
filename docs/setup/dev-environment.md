# Development Environment Setup

## Prerequisites
- Python 3.12+ (managed via uv)
- Node.js 20+ (for frontend)
- Docker (for Neo4j + Redis)
- uv package manager

## Quick Start

### 1. Install uv
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Start Docker services
```bash
docker compose up -d
# Neo4j Browser: http://localhost:7474
# Redis: localhost:6379
```

### 3. Backend setup
```bash
uv sync
cp .env.example .env
# Edit .env with your API keys
uv run fastapi dev backend/main.py
```

### 4. Frontend setup
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### 5. Verify
- Neo4j Browser accessible at http://localhost:7474
- Backend API docs at http://localhost:8000/docs
- Frontend at http://localhost:5173

## Environment Variables
See `.env.example` for all required variables.
