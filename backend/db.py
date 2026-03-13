from __future__ import annotations

import sqlite3
from pathlib import Path
from datetime import datetime, timezone

from .settings import DATA_DIR

DB_PATH = DATA_DIR / "metadata.db"


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                uploaded_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def add_file(file_id: str, filename: str, stored_path: Path) -> None:
    uploaded_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO files (id, filename, stored_path, uploaded_at) VALUES (?, ?, ?, ?)",
            (file_id, filename, str(stored_path), uploaded_at),
        )
        conn.commit()


def list_files() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, stored_path, uploaded_at FROM files ORDER BY uploaded_at DESC"
        ).fetchall()

    return [
        {
            "id": row[0],
            "filename": row[1],
            "stored_path": row[2],
            "uploaded_at": row[3],
        }
        for row in rows
    ]
