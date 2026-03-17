# Enterprise Knowledge Base

Enterprise knowledge base with document ingestion and semantic search.

Features:
- Document upload (PDF, DOCX)
- Automatic parsing and vector indexing
- Hybrid search (vector + BM25) with source attribution
- Answer generation with citations

Tech stack:
- Backend: FastAPI, LlamaIndex, Chroma, LangGraph
- LLM: DeepSeek (chat)
- Embedding: BGE (HuggingFace)
- Frontend: Next.js, MUI

## Project Structure

- `backend/` API server and indexing pipeline
- `frontend/` UI
- `scripts/` helper scripts

## Prerequisites

- Python 3.11 or 3.12
- Node.js 18+

## Backend Setup

```powershell
cd <project-root>
python -m venv backend\.venv
backend\.venv\Scripts\activate
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
```

Edit `backend\.env` and set:
- `DEEPSEEK_API_KEY`
- Optional: `HF_EMBED_MODEL` (default `BAAI/bge-small-zh-v1.5`)

Start the API:
```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### One-click Start

```powershell
.\scripts\start-backend.ps1
```

Custom port:
```powershell
.\scripts\start-backend.ps1 -Port 9000
```

## Frontend Setup

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## API Endpoints

- `GET /health` health check
- `POST /upload` upload document
- `POST /search` search and answer
- `GET /files` list uploaded documents

## Deploy (Render + Vercel)

Recommended deployment:
- Backend on Render (persistent disk for Chroma)
- Frontend on Vercel

### Render (Backend, Docker)

This repo includes a Docker-based `render.yaml` blueprint. On Render:
1. Create a new Blueprint deployment.
2. Select this repository.
3. Set `DEEPSEEK_API_KEY` as a secret environment variable.
4. Deploy. Render will provision a disk mounted at `/var/data`.

Environment variables used by the backend:
- `DEEPSEEK_API_KEY` (required)
- `DEEPSEEK_API_BASE` (default `https://api.deepseek.com/v1`)
- `DEEPSEEK_MODEL` (default `deepseek-chat`)
- `HF_EMBED_MODEL` (default `BAAI/bge-small-zh-v1.5`)
- `DATA_DIR` (default `backend/data`), `UPLOAD_DIR`, `CHROMA_DIR`
- `CORS_ORIGINS` (comma-separated, e.g. `http://localhost:3000,https://your-vercel-domain.vercel.app`)

### Vercel (Frontend)

1. Import the repo in Vercel.
2. Set the Root Directory to `frontend`.
3. Add environment variable `NEXT_PUBLIC_KNOWLEDGE_LIB_API_BASE` pointing to your Render backend URL.
4. Deploy.

## Notes

- Encrypted or scanned PDFs require decryption/OCR before upload.
- If you change `.env`, restart the backend.
