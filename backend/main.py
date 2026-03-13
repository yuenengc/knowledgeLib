from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .db import init_db, add_file, list_files
from .graph import run_search
from .indexer import get_index, insert_documents, load_documents
from .settings import UPLOAD_DIR, configure_llm

ALLOWED_EXTS = {".pdf", ".docx"}

app = FastAPI(title="Enterprise Knowledge Base")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"] ,
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@app.on_event("startup")
async def startup() -> None:
    init_db()
    configure_llm()
    get_index()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/files")
async def files() -> dict:
    return {"files": list_files()}


@app.post("/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    file_id = str(uuid4())
    stored_path = UPLOAD_DIR / f"{file_id}{ext}"

    with stored_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    metadata = {
        "file_name": file.filename,
        "file_id": file_id,
        "stored_path": str(stored_path),
    }

    try:
        docs = load_documents(stored_path, metadata)
        if not docs or all(not getattr(doc, "get_content", lambda: "")() for doc in docs):
            raise HTTPException(
                status_code=400,
                detail="Document has no extractable text (encrypted or scanned). Please upload a decrypted or text-based file.",
            )
        index = get_index()
        insert_documents(index, docs)
    except HTTPException:
        if stored_path.exists():
            stored_path.unlink(missing_ok=True)
        raise
    except Exception:
        if stored_path.exists():
            stored_path.unlink(missing_ok=True)
        raise

    add_file(file_id, file.filename, stored_path)

    return {"id": file_id, "filename": file.filename}


@app.post("/search")
async def search(request: SearchRequest) -> dict:
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is required")

    index = get_index()
    results = run_search(index, query, request.top_k)
    return {"query": request.query, "results": results}
