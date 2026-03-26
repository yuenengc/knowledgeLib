from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .db import (
    init_db,
    add_file,
    list_files,
    add_nodes,
    get_files_by_name,
    list_node_ids_by_file_ids,
    delete_nodes_by_file_ids,
    delete_files_by_ids,
)
from .graph import run_search, stream_answer
from .indexer import build_nodes, get_index, insert_nodes, load_documents, delete_nodes_by_ids, clear_vector_store
from .settings import UPLOAD_DIR, configure_llm, get_llm_config
import os
import asyncio
import json

ALLOWED_EXTS = {".pdf", ".docx"}

app = FastAPI(title="Enterprise Knowledge Base")

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
allow_origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


_init_lock = asyncio.Lock()
_initialized = False


async def ensure_initialized() -> None:
    global _initialized
    if _initialized:
        return
    async with _init_lock:
        if _initialized:
            return
        init_db()
        configure_llm()
        _initialized = True


def _remove_previous_versions(filename: str) -> None:
    existing_files = get_files_by_name(filename)
    if not existing_files:
        return

    old_file_ids = [f["id"] for f in existing_files]
    old_paths = [f["stored_path"] for f in existing_files]

    node_ids = list_node_ids_by_file_ids(old_file_ids)
    delete_nodes_by_ids(node_ids)
    delete_nodes_by_file_ids(old_file_ids)
    delete_files_by_ids(old_file_ids)

    for old_path in old_paths:
        try:
            Path(old_path).unlink(missing_ok=True)
        except Exception:
            pass


@app.get("/health")
async def health() -> dict:
    await ensure_initialized()
    return {"status": "ok", "llm": get_llm_config()}


@app.get("/files")
async def files() -> dict:
    await ensure_initialized()
    return {"files": list_files()}


@app.post("/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    await ensure_initialized()
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    _remove_previous_versions(file.filename)

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
        nodes = build_nodes(docs)
        if not nodes:
            raise HTTPException(
                status_code=400,
                detail="Document produced no text chunks. Please upload a text-based file.",
            )
        insert_nodes(index, nodes)
        add_nodes(
            [
                {
                    "id": node.node_id,
                    "file_id": metadata["file_id"],
                    "file_name": metadata["file_name"],
                    "stored_path": metadata["stored_path"],
                    "text": node.get_content(),
                    "order_idx": node.metadata.get("order_idx"),
                }
                for node in nodes
            ]
        )
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


@app.post("/clear")
async def clear_all() -> dict:
    await ensure_initialized()
    files = list_files()
    if files:
        file_ids = [f["id"] for f in files]
        node_ids = list_node_ids_by_file_ids(file_ids)
        delete_nodes_by_ids(node_ids)
        delete_nodes_by_file_ids(file_ids)
        delete_files_by_ids(file_ids)
        for f in files:
            try:
                Path(f["stored_path"]).unlink(missing_ok=True)
            except Exception:
                pass

    clear_vector_store()
    return {"status": "cleared", "files": len(files)}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/search/stream")
async def search_stream(request: SearchRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is required")

    await ensure_initialized()
    index = get_index()
    payload = run_search(index, query, request.top_k)
    results = payload.get("results", [])

    async def event_gen():
        yield _sse("results", {"results": results})
        if not results:
            yield _sse("done", {"usage": {}})
            return

        async for evt in stream_answer(query, results):
            if evt.get("type") == "delta":
                yield _sse("delta", {"content": evt.get("content", "")})
            elif evt.get("type") == "usage":
                yield _sse("usage", evt.get("usage", {}))
            elif evt.get("type") == "error":
                yield _sse("error", {"message": evt.get("message", "检索失败")})

        yield _sse("done", {})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
