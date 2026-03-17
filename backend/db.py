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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                text TEXT NOT NULL,
                order_idx INTEGER
            )
            """
        )
        # Backfill schema if older DB exists.
        try:
            conn.execute("ALTER TABLE nodes ADD COLUMN order_idx INTEGER")
        except sqlite3.OperationalError:
            pass
        conn.commit()


def add_file(file_id: str, filename: str, stored_path: Path) -> None:
    uploaded_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO files (id, filename, stored_path, uploaded_at) VALUES (?, ?, ?, ?)",
            (file_id, filename, str(stored_path), uploaded_at),
        )
        conn.commit()


def get_files_by_name(filename: str) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, filename, stored_path, uploaded_at FROM files WHERE filename = ?",
            (filename,),
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


def list_node_ids_by_file_ids(file_ids: list[str]) -> list[str]:
    if not file_ids:
        return []
    placeholders = ",".join("?" for _ in file_ids)
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            f"SELECT id FROM nodes WHERE file_id IN ({placeholders})",
            file_ids,
        ).fetchall()
    return [row[0] for row in rows]


def delete_nodes_by_file_ids(file_ids: list[str]) -> None:
    if not file_ids:
        return
    placeholders = ",".join("?" for _ in file_ids)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            f"DELETE FROM nodes WHERE file_id IN ({placeholders})",
            file_ids,
        )
        conn.commit()


def delete_files_by_ids(file_ids: list[str]) -> None:
    if not file_ids:
        return
    placeholders = ",".join("?" for _ in file_ids)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            f"DELETE FROM files WHERE id IN ({placeholders})",
            file_ids,
        )
        conn.commit()


def add_nodes(nodes: list[dict]) -> None:
    if not nodes:
        return
    with sqlite3.connect(DB_PATH) as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO nodes (id, file_id, file_name, stored_path, text, order_idx)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    node["id"],
                    node["file_id"],
                    node["file_name"],
                    node["stored_path"],
                    node["text"],
                    node.get("order_idx"),
                )
                for node in nodes
            ],
        )
        conn.commit()


def list_nodes() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, file_id, file_name, stored_path, text, order_idx FROM nodes"
        ).fetchall()
    return [
        {
            "id": row[0],
            "file_id": row[1],
            "file_name": row[2],
            "stored_path": row[3],
            "text": row[4],
            "order_idx": row[5],
        }
        for row in rows
    ]
