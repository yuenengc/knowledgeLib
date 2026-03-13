# Enterprise Knowledge Base

Two-tab knowledge base app:
- Upload documents (PDF, Word, PPT)
- Semantic search with source file attribution

## Backend (FastAPI + LlamaIndex + Chroma + LangGraph)

```powershell
cd f:\CYN\code\python\knowledge-lib
python -m venv backend\.venv
backend\.venv\Scripts\activate
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
# edit backend\.env with your DeepSeek API key
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### One-click script

```powershell
f:\CYN\code\python\knowledge-lib\scripts\start-backend.ps1
```

Custom port:
```powershell
f:\CYN\code\python\knowledge-lib\scripts\start-backend.ps1 -Port 9000
```

## Frontend (Next.js + MUI)

```powershell
cd f:\CYN\code\python\knowledge-lib\frontend
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.
