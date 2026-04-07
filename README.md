# Enterprise Knowledge Base

Enterprise knowledge base with document ingestion and semantic search.

Features:

- Document upload (PDF, DOCX)
- Automatic parsing and vector indexing
- Hybrid search (vector + BM25) with source attribution
- Streaming answer generation with citations
- Chat session management and history persistence

Tech stack:

- Backend: FastAPI, LlamaIndex, Chroma, LangGraph
- LLM: DeepSeek (chat)
- Embedding: BGE (HuggingFace)
- Frontend: Next.js, React, Tailwind CSS, lucide-react

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
- `POST /search/stream` search and stream answer
- `GET /files` list uploaded documents
- `DELETE /files/{file_id}` delete uploaded document
- `GET /chats` list chat sessions
- `POST /chats` create chat session
- `GET /chats/{chat_id}` get chat detail and messages
- `PATCH /chats/{chat_id}` rename chat
- `DELETE /chats/{chat_id}` delete chat
- `GET /chunks/{chunk_id}` get chunk detail

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
- `EMBED_QUERY_PREFIX` (optional, adds a prefix to queries for vector search, e.g. `为这个句子生成表示以用于检索相关文章：`)
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
- SQLite metadata is stored in `backend/data/metadata.db`.
- Chroma vector data is stored in `backend/chroma_db/`.

## Data Model

Current metadata storage uses SQLite with five core tables:

- `files`: uploaded file metadata
- `chunks`: parsed text chunks for retrieval and source preview
- `chats`: chat session metadata
- `messages`: user and assistant messages
- `citations`: chunk-level citations attached to assistant messages

Design notes:

- `chunks.file_id` references `files.id`
- `messages.chat_id` references `chats.id`
- `citations.message_id` references `messages.id`
- `citations.chunk_id` references `chunks.id`
- chat/message/citation cleanup relies on foreign-key cascade
- retrieval uses Chroma for vector search and SQLite `chunks` for BM25 fallback
