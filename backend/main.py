from __future__ import annotations

import shutil
import logging
import time
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .db import (
    init_db,
    add_file,
    list_files,
    list_chunk_ids_by_file_ids,
    delete_chunks_by_file_ids,
    delete_files_by_ids,
    add_chat,
    add_message,
    get_chat,
    list_chats,
    list_messages,
    delete_messages_by_ids,
    delete_chat,
    list_chunks_by_file_id,
    add_citations,
    list_citations_by_message,
    get_chunk_by_id,
    touch_chat,
    update_chat_title,
    clear_all_tables,
)
from .graph import run_search, stream_answer
from .indexer import get_index, delete_nodes_by_ids, clear_vector_store
from .settings import (
    UPLOAD_DIR,
    configure_llm,
    get_llm_config,
    is_llm_enabled,
    CHAT_MAX_MESSAGES,
    CHAT_MAX_TOKENS,
    CHAT_SUMMARY_WINDOW,
    CHAT_WARN_RATIO,
    CHAT_MAX_SESSIONS,
    SEARCH_LLM_TOP_K,
)
from .task_manager import create_task, get_task
from .upload_worker import enqueue_uploaded_file_processing
from llama_index.core import Settings
import os
import asyncio
import json
import re

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("knowledge-lib.main")

ALLOWED_EXTS = {".pdf", ".docx"}
NO_RESULTS_MESSAGE = "未找到相关信息"

app = FastAPI(title="Enterprise Knowledge Base")

_cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,https://knowledge-lib-git-lowrambranch-ellens-projects-86a09ee4.vercel.app",
)
allow_origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]
_cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https://.*\.vercel\.app$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    top_k: int = SEARCH_LLM_TOP_K
    chat_id: str | None = None


class CreateChatRequest(BaseModel):
    title: str | None = None


class UpdateChatRequest(BaseModel):
    title: str


class AddMessageRequest(BaseModel):
    role: str
    content: str


_init_lock = asyncio.Lock()
_initialized = False


async def ensure_initialized() -> None:
    # One-time startup: init lightweight app state only.
    # Embeddings are initialized lazily by retrieval/ingestion paths so upload can
    # return a task_id even if the local model cache needs repair.
    global _initialized
    if _initialized:
        return
    async with _init_lock:
        if _initialized:
            return
        init_db()
        configure_llm()
        _initialized = True


def _save_upload_file(file: UploadFile, stored_path: Path) -> None:
    with stored_path.open("wb") as output:
        shutil.copyfileobj(file.file, output)


@app.get("/health")
async def health() -> dict:
    await ensure_initialized()
    return {"status": "ok", "llm": get_llm_config()}


@app.get("/files")
async def files() -> dict:
    await ensure_initialized()
    return {"files": list_files()}


@app.get("/sources/{file_id}")
async def source_detail(file_id: str, limit: int = 3):
    await ensure_initialized()
    items = list_chunks_by_file_id(file_id, max(1, min(limit, 10)))
    return _json_response_with_cache({"file_id": file_id, "items": items})



@app.get("/chunks/{chunk_id}")
async def chunk_detail(chunk_id: str):
    await ensure_initialized()
    chunk = get_chunk_by_id(chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return _json_response_with_cache({"chunk": chunk})


@app.delete("/files/{file_id}")
async def delete_file(file_id: str) -> dict:
    await ensure_initialized()
    files = list_files()
    target = next((f for f in files if f["id"] == file_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="File not found")

    chunk_ids = list_chunk_ids_by_file_ids([file_id])
    delete_nodes_by_ids(chunk_ids)
    delete_chunks_by_file_ids([file_id])
    delete_files_by_ids([file_id])
    try:
        Path(target["stored_path"]).unlink(missing_ok=True)
    except Exception:
        pass

    return {"status": "deleted", "id": file_id, "filename": target["filename"]}


@app.get("/task/{task_id}")
async def task_status(task_id: str) -> dict:
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/upload")
async def upload(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict:
    await ensure_initialized()
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    file_id = str(uuid4())
    task_id = str(uuid4())
    stored_path = UPLOAD_DIR / f"{file_id}{ext}"
    add_file(file_id, filename, stored_path, status="processing")
    task = create_task(task_id, filename)

    # Persist raw upload without blocking the event loop.
    await run_in_threadpool(_save_upload_file, file, stored_path)

    background_tasks.add_task(
        enqueue_uploaded_file_processing,
        task_id=task_id,
        file_id=file_id,
        filename=filename,
        stored_path=stored_path,
    )
    logger.info("[task:%s] upload accepted filename=%s file_id=%s", task_id, filename, file_id)
    return {
        "id": file_id,
        "task_id": task_id,
        "filename": filename,
        "status": task["status"],
        "progress": task["progress"],
    }


@app.post("/clear")
async def clear_all() -> dict:
    await ensure_initialized()
    files = list_files()
    if files:
        # Remove uploaded files from disk first.
        for f in files:
            try:
                Path(f["stored_path"]).unlink(missing_ok=True)
            except Exception:
                pass

        # Best-effort delete child nodes; then drop the whole collection.
        file_ids = [f["id"] for f in files]
        chunk_ids = list_chunk_ids_by_file_ids(file_ids)
        delete_nodes_by_ids(chunk_ids)

    clear_vector_store()
    clear_all_tables()
    return {"status": "cleared", "files": len(files), "tables": "all"}


def _sse(event: str, data: dict) -> str:
    # Format a Server-Sent Events message.
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _json_response_with_cache(payload: dict, max_age: int = 300) -> JSONResponse:
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"private, max-age={max_age}"},
    )

def _extract_cited_indices(text: str) -> list[int]:
    # Extract [n] citations from LLM output to filter used sources.
    if not text:
        return []
    indices: set[int] = set()
    for match in re.finditer(r"\[(\d+)\]", text):
        try:
            value = int(match.group(1))
        except ValueError:
            continue
        if value > 0:
            indices.add(value)
    return sorted(indices)


def _build_quote_excerpt(text: str, limit: int = 100) -> str:
    normalized = " ".join((text or "").split())
    if not normalized:
        return ""
    parts = re.split(r"(?<=[。！？；.!?;])\s*", normalized, maxsplit=1)
    sentence = parts[0].strip() if parts else normalized
    return sentence[:limit]


def _generate_title(text: str) -> str:
    if not text:
        return "未命名对话"
    normalized = " ".join(text.strip().split())
    return normalized[:24] if normalized else "未命名对话"


def _should_auto_title(title: str) -> bool:
    return title in {"新对话", "未命名对话", ""}


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    other = len(text) - cjk
    return cjk + max(0, other // 4)


def _count_message_tokens(messages: list[dict]) -> int:
    return sum(_estimate_tokens(m.get("content", "")) for m in messages)


def _chat_stats(messages: list[dict]) -> dict:
    message_count = len(messages)
    token_estimate = _count_message_tokens(messages)
    warn_by_messages = message_count >= int(CHAT_MAX_MESSAGES * CHAT_WARN_RATIO)
    warn_by_tokens = token_estimate >= int(CHAT_MAX_TOKENS * CHAT_WARN_RATIO)
    return {
        "message_count": message_count,
        "token_estimate": token_estimate,
        "max_messages": CHAT_MAX_MESSAGES,
        "max_tokens": CHAT_MAX_TOKENS,
        "warn": warn_by_messages or warn_by_tokens,
    }


def _summarize_messages(messages: list[dict]) -> str:
    if not messages:
        return ""
    content = "\n".join(
        f"{m.get('role', 'user')}: {m.get('content', '').strip()}" for m in messages
    )
    if is_llm_enabled() and Settings.llm is not None:
        prompt = (
            "请将以下对话总结为一条简洁的摘要，保留关键信息、决定和未解决问题，"
            "使用中文，控制在200字以内。\n\n"
            f"{content}\n\n"
            "摘要："
        )
        try:
            resp = Settings.llm.complete(prompt)
            summary = getattr(resp, "text", None) or str(resp)
            return summary.strip() or "对话摘要：略。"
        except Exception:
            pass
    # Fallback: compress by truncation
    condensed = content.replace("\n", " ")
    return (condensed[:200] + "…") if len(condensed) > 200 else condensed


def _enforce_chat_limits(chat_id: str) -> None:
    messages = list_messages(chat_id)
    if not messages:
        return

    max_messages = CHAT_MAX_MESSAGES
    max_tokens = CHAT_MAX_TOKENS

    if (len(messages) > max_messages or _count_message_tokens(messages) > max_tokens) and len(messages) > CHAT_SUMMARY_WINDOW:
        to_summarize = messages[:CHAT_SUMMARY_WINDOW]
        remaining = messages[CHAT_SUMMARY_WINDOW:]
        summary = _summarize_messages(to_summarize)
        if not summary:
            return
        summary_message = {
            "id": str(uuid4()),
            "chat_id": chat_id,
            "role": "assistant",
            "content": f"对话摘要：{summary}",
            "created_at": to_summarize[-1].get("created_at"),
        }
        delete_messages_by_ids([m["id"] for m in to_summarize if m.get("id")])
        add_message(summary_message)
        messages = [summary_message] + remaining


def _strip_citations_from_content(text: str) -> str:
    if not text:
        return ""
    parts = re.split(r"\n### 引用[\s\S]*$", text, flags=re.MULTILINE)
    cleaned = parts[0] if parts else text
    return cleaned.strip()


@app.get("/chats")
async def chats() -> dict:
    await ensure_initialized()
    return {"chats": list_chats()}


@app.post("/chats")
async def create_chat(payload: CreateChatRequest) -> dict:
    await ensure_initialized()
    if len(list_chats()) >= CHAT_MAX_SESSIONS:
        raise HTTPException(status_code=400, detail="Chat session limit reached")
    chat_id = str(uuid4())
    title = payload.title.strip() if payload.title else "新对话"
    add_chat(chat_id, title)
    return {"id": chat_id, "title": title}


@app.get("/chats/{chat_id}")
async def chat_detail(chat_id: str) -> dict:
    await ensure_initialized()
    chat = get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages = list_messages(chat_id)
    enriched = []
    for msg in messages:
        if msg.get("role") == "assistant":
            citations = list_citations_by_message(msg["id"])
            msg = {**msg, "citations": citations}
        enriched.append(msg)
    return {"chat": chat, "messages": enriched, "stats": _chat_stats(messages)}


@app.patch("/chats/{chat_id}")
async def update_chat(chat_id: str, payload: UpdateChatRequest) -> dict:
    await ensure_initialized()
    chat = get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    update_chat_title(chat_id, title)
    return {"id": chat_id, "title": title}


@app.delete("/chats/{chat_id}")
async def delete_chat_session(chat_id: str) -> dict:
    await ensure_initialized()
    chat = get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    delete_chat(chat_id)
    return {"status": "deleted", "id": chat_id}


@app.post("/chats/{chat_id}/messages")
async def add_chat_message(chat_id: str, payload: AddMessageRequest) -> dict:
    await ensure_initialized()
    chat = get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    role = payload.role.strip()
    if role not in {"user", "assistant"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")
    add_message(
        {
            "id": str(uuid4()),
            "chat_id": chat_id,
            "role": role,
            "content": content,
        }
    )
    _enforce_chat_limits(chat_id)
    if role == "user" and _should_auto_title(chat["title"]):
        update_chat_title(chat_id, _generate_title(content))
    else:
        touch_chat(chat_id)
    return {"status": "ok"}


@app.post("/search/stream")
async def search_stream(request: SearchRequest):
    request_t0 = time.perf_counter()
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is required")

    stage_t0 = time.perf_counter()
    await ensure_initialized()
    logger.info("----logger   [timing.search_stream] ensure_initialized_ms=%.1f", (time.perf_counter() - stage_t0) * 1000)

    stage_t0 = time.perf_counter()
    logger.info("----logger   [timing.search_stream] configure_llm_ms=%.1f", (time.perf_counter() - stage_t0) * 1000)

    chat_id = request.chat_id
    assistant_message_id = str(uuid4())
    if chat_id:
        stage_t0 = time.perf_counter()
        chat = get_chat(chat_id)
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        add_message(
            {
                "id": str(uuid4()),
                "chat_id": chat_id,
                "role": "user",
                "content": query,
            }
        )
        _enforce_chat_limits(chat_id)
        if _should_auto_title(chat["title"]):
            update_chat_title(chat_id, _generate_title(query))
        else:
            touch_chat(chat_id)
        logger.info("----logger   [timing.search_stream] chat_persist_ms=%.1f", (time.perf_counter() - stage_t0) * 1000)
    # Retrieve relevant chunks first, then stream answer tokens.
    stage_t0 = time.perf_counter()
    index = get_index()
    logger.info("----logger   [timing.search_stream] get_index_ms=%.1f", (time.perf_counter() - stage_t0) * 1000)

    stage_t0 = time.perf_counter()
    payload = run_search(index, query, request.top_k)
    results = payload.get("results", [])
    logger.info(
        "----logger   [timing.search_stream] run_search_ms=%.1f results=%s pre_stream_total_ms=%.1f",
        (time.perf_counter() - stage_t0) * 1000,
        len(results),
        (time.perf_counter() - request_t0) * 1000,
    )

    async def event_gen():
        stream_t0 = time.perf_counter()
        yield _sse("results", {"results": results})
        if not results:
            if chat_id:
                add_message(
                    {
                        "id": assistant_message_id,
                        "chat_id": chat_id,
                        "role": "assistant",
                        "content": NO_RESULTS_MESSAGE,
                    }
                )
                _enforce_chat_limits(chat_id)
                touch_chat(chat_id)
            yield _sse("done", {"usage": {}})
            logger.info(
                "----logger   [timing.search_stream] stream_total_ms=%.1f request_total_ms=%.1f no_results=1",
                (time.perf_counter() - stream_t0) * 1000,
                (time.perf_counter() - request_t0) * 1000,
            )
            return

        answer_parts: list[str] = []
        async for evt in stream_answer(query, results):
            if evt.get("type") == "delta":
                content = evt.get("content", "")
                if content:
                    answer_parts.append(content)
                yield _sse("delta", {"content": content})
            elif evt.get("type") == "usage":
                yield _sse("usage", evt.get("usage", {}))
            elif evt.get("type") == "error":
                yield _sse("error", {"message": evt.get("message", "检索失败")})

        full_answer = "".join(answer_parts)
        if chat_id and full_answer:
            used_indices = _extract_cited_indices(full_answer)
            used_results = [
                results[idx - 1] for idx in used_indices if 0 <= idx - 1 < len(results)
            ]
            add_message(
                {
                    "id": assistant_message_id,
                    "chat_id": chat_id,
                    "role": "assistant",
                    "content": _strip_citations_from_content(full_answer),
                }
            )
            if used_results:
                valid_citations = []
                invalid_chunk_ids = []
                for rank, item in enumerate(used_results, start=1):
                    chunk_id = item.get("chunk_id") or item.get("id")
                    if not chunk_id:
                        continue
                    if get_chunk_by_id(chunk_id) is None:
                        invalid_chunk_ids.append(chunk_id)
                        continue
                    valid_citations.append(
                        {
                            "chunk_id": chunk_id,
                            "quote_text": item.get("text") or "",
                            "rank": rank,
                            "score": item.get("score"),
                        }
                    )
                if invalid_chunk_ids:
                    logger.warning(
                        "----logger   [citations] skipped invalid chunk ids: %s",
                        invalid_chunk_ids,
                    )
                add_citations(
                    assistant_message_id,
                    valid_citations,
                )
            _enforce_chat_limits(chat_id)
            touch_chat(chat_id)
        used_indices = _extract_cited_indices(full_answer)
        used_results = [
            results[idx - 1] for idx in used_indices if 0 <= idx - 1 < len(results)
        ]
        used_results_payload = [
            {
                **item,
                "quote_text": _build_quote_excerpt(item.get("text") or ""),
            }
            for item in used_results
        ]
        yield _sse(
            "used_results",
            {"results": used_results_payload, "indices": used_indices},
        )

        yield _sse("done", {})
        logger.info(
            "----logger   [timing.search_stream] stream_total_ms=%.1f request_total_ms=%.1f answer_chars=%s",
            (time.perf_counter() - stream_t0) * 1000,
            (time.perf_counter() - request_t0) * 1000,
            len(full_answer),
        )

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
