from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Literal, TypedDict

TaskStatus = Literal[
    "pending",
    "parsing",
    "chunking",
    "embedding",
    "storing",
    "completed",
    "failed",
]


class TaskSnapshot(TypedDict):
    task_id: str
    status: TaskStatus
    progress: int
    filename: str
    error: str | None
    created_at: str
    updated_at: str


_tasks: dict[str, TaskSnapshot] = {}
_lock = Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_task(task_id: str, filename: str) -> TaskSnapshot:
    timestamp = _now()
    task: TaskSnapshot = {
        "task_id": task_id,
        "status": "pending",
        "progress": 0,
        "filename": filename,
        "error": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    with _lock:
        _tasks[task_id] = task
    return task.copy()


def update_task(
    task_id: str,
    *,
    status: TaskStatus | None = None,
    progress: int | None = None,
    error: str | None = None,
) -> TaskSnapshot | None:
    with _lock:
        task = _tasks.get(task_id)
        if task is None:
            return None
        if status is not None:
            task["status"] = status
        if progress is not None:
            task["progress"] = max(0, min(100, progress))
        if error is not None:
            task["error"] = error
        task["updated_at"] = _now()
        return task.copy()


def fail_task(task_id: str, error: str) -> TaskSnapshot | None:
    return update_task(task_id, status="failed", error=error)


def get_task(task_id: str) -> TaskSnapshot | None:
    with _lock:
        task = _tasks.get(task_id)
        return task.copy() if task is not None else None
