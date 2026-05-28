from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from fastapi import HTTPException

from .db import (
    add_chunks,
    delete_chunks_by_file_ids,
    delete_files_by_ids,
    get_files_by_name,
    list_chunk_ids_by_file_ids,
    update_file_status,
)
from .indexer import build_nodes, delete_nodes_by_ids, get_index, insert_nodes, load_documents
from .settings import configure_embeddings
from .task_manager import fail_task, update_task

logger = logging.getLogger("knowledge-lib.upload")
_INGESTION_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-ingestion")
_RUNNING_TASKS: dict[str, Future[None]] = {}


def _task_prefix(task_id: str) -> str:
    return f"[task:{task_id}]"


def enqueue_uploaded_file_processing(
    *,
    task_id: str,
    file_id: str,
    filename: str,
    stored_path: Path,
) -> None:
    """Submit ingestion to a dedicated worker thread and return immediately."""
    future = _INGESTION_EXECUTOR.submit(
        process_uploaded_file,
        task_id=task_id,
        file_id=file_id,
        filename=filename,
        stored_path=stored_path,
    )
    _RUNNING_TASKS[task_id] = future
    future.add_done_callback(lambda done: _RUNNING_TASKS.pop(task_id, None))
    logger.info("%s ingestion queued filename=%s file_id=%s", _task_prefix(task_id), filename, file_id)


def _remove_previous_versions(filename: str, current_file_id: str, task_id: str) -> None:
    existing_files = [
        item for item in get_files_by_name(filename) if item.get("id") != current_file_id
    ]
    if not existing_files:
        return

    old_file_ids = [item["id"] for item in existing_files]
    old_paths = [item["stored_path"] for item in existing_files]
    logger.info(
        "%s removing previous versions count=%s filename=%s",
        _task_prefix(task_id),
        len(old_file_ids),
        filename,
    )

    chunk_ids = list_chunk_ids_by_file_ids(old_file_ids)
    delete_nodes_by_ids(chunk_ids)
    delete_chunks_by_file_ids(old_file_ids)
    delete_files_by_ids(old_file_ids)

    for old_path in old_paths:
        try:
            Path(old_path).unlink(missing_ok=True)
        except Exception:
            logger.warning(
                "%s failed to remove old upload path=%s",
                _task_prefix(task_id),
                old_path,
                exc_info=True,
            )


def process_uploaded_file(
    *,
    task_id: str,
    file_id: str,
    filename: str,
    stored_path: Path,
) -> None:
    metadata = {
        "file_name": filename,
        "file_id": file_id,
        "stored_path": str(stored_path),
    }

    try:
        _remove_previous_versions(filename, file_id, task_id)

        update_task(task_id, status="parsing", progress=10)
        logger.info("%s parsing started filename=%s path=%s", _task_prefix(task_id), filename, stored_path)
        docs = load_documents(stored_path, metadata)
        if not docs or all(not getattr(doc, "get_content", lambda: "")() for doc in docs):
            raise HTTPException(
                status_code=400,
                detail="Document has no extractable text (encrypted or scanned). Please upload a decrypted or text-based file.",
            )
        logger.info("%s parsing completed document_count=%s", _task_prefix(task_id), len(docs))

        update_task(task_id, status="chunking", progress=35)
        logger.info("%s chunking started", _task_prefix(task_id))
        index_nodes, db_nodes = build_nodes(docs)
        if not index_nodes or not db_nodes:
            raise HTTPException(
                status_code=400,
                detail="Document produced no text chunks. Please upload a text-based file.",
            )
        logger.info(
            "%s chunk count=%s db_node_count=%s",
            _task_prefix(task_id),
            len(index_nodes),
            len(db_nodes),
        )

        update_task(task_id, status="embedding", progress=65)
        logger.info("%s embedding started", _task_prefix(task_id))
        configure_embeddings()
        logger.info("%s chroma storing started", _task_prefix(task_id))
        index = get_index()
        insert_nodes(index, index_nodes)
        logger.info("%s embedding completed", _task_prefix(task_id))
        logger.info("%s chroma storing completed node_count=%s", _task_prefix(task_id), len(index_nodes))

        update_task(task_id, status="storing", progress=90)
        logger.info("%s sqlite metadata storing started", _task_prefix(task_id))
        add_chunks(
            [
                {
                    "id": node.node_id,
                    "file_id": file_id,
                    "text": node.get_content(),
                    "order_idx": node.metadata.get("order_idx"),
                    "parent_id": node.metadata.get("parent_id"),
                }
                for node in db_nodes
            ]
        )
        update_file_status(file_id, "ready")
        update_task(task_id, status="completed", progress=100)
        logger.info("%s ingestion completed filename=%s", _task_prefix(task_id), filename)
    except HTTPException as exc:
        update_file_status(file_id, "error")
        stored_path.unlink(missing_ok=True)
        fail_task(task_id, str(exc.detail))
        logger.warning("%s upload rejected filename=%s error=%s", _task_prefix(task_id), filename, exc.detail)
    except Exception as exc:
        update_file_status(file_id, "error")
        stored_path.unlink(missing_ok=True)
        fail_task(task_id, str(exc))
        logger.exception("%s unexpected upload failure filename=%s", _task_prefix(task_id), filename)
