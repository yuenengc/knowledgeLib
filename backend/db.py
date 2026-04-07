from __future__ import annotations

import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .settings import DATA_DIR

DB_PATH = DATA_DIR / "metadata.db"
_WRITE_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _WRITE_LOCK:
        with _connect() as conn:
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
                CREATE TABLE IF NOT EXISTS chats (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    order_idx INTEGER,
                    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS citations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL,
                    chunk_id TEXT NOT NULL,
                    rank INTEGER NOT NULL,
                    quote_text TEXT NOT NULL,
                    score REAL,
                    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chunks_file_order ON chunks(file_id, order_idx)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_citations_message_rank ON citations(message_id, rank)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_citations_chunk_id ON citations(chunk_id)"
            )
            conn.commit()


def add_file(file_id: str, filename: str, stored_path: Path) -> None:
    uploaded_at = datetime.now(timezone.utc).isoformat()
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO files (id, filename, stored_path, uploaded_at) VALUES (?, ?, ?, ?)",
                (file_id, filename, str(stored_path), uploaded_at),
            )
            conn.commit()


def get_files_by_name(filename: str) -> list[dict]:
    with _connect() as conn:
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
    with _connect() as conn:
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


def list_chunk_ids_by_file_ids(file_ids: list[str]) -> list[str]:
    if not file_ids:
        return []
    placeholders = ",".join("?" for _ in file_ids)
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT id FROM chunks WHERE file_id IN ({placeholders})",
            file_ids,
        ).fetchall()
    return [row[0] for row in rows]


def delete_chunks_by_file_ids(file_ids: list[str]) -> None:
    if not file_ids:
        return
    placeholders = ",".join("?" for _ in file_ids)
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                f"DELETE FROM chunks WHERE file_id IN ({placeholders})",
                file_ids,
            )
            conn.commit()


def delete_files_by_ids(file_ids: list[str]) -> None:
    if not file_ids:
        return
    placeholders = ",".join("?" for _ in file_ids)
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                f"DELETE FROM files WHERE id IN ({placeholders})",
                file_ids,
            )
            conn.commit()


def add_chunks(chunks: list[dict]) -> None:
    if not chunks:
        return
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO chunks (id, file_id, text, order_idx)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        chunk["id"],
                        chunk["file_id"],
                        chunk["text"],
                        chunk.get("order_idx"),
                    )
                    for chunk in chunks
                ],
            )
            conn.commit()


def add_chat(chat_id: str, title: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (chat_id, title, timestamp, timestamp),
            )
            conn.commit()


def update_chat_title(chat_id: str, title: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
                (title, timestamp, chat_id),
            )
            conn.commit()


def touch_chat(chat_id: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                "UPDATE chats SET updated_at = ? WHERE id = ?",
                (timestamp, chat_id),
            )
            conn.commit()


def get_chat(chat_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats WHERE id = ?",
            (chat_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "title": row[1],
        "created_at": row[2],
        "updated_at": row[3],
    }


def list_chats() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
    return [
        {
            "id": row[0],
            "title": row[1],
            "created_at": row[2],
            "updated_at": row[3],
        }
        for row in rows
    ]


def add_message(message: dict) -> None:
    if not message:
        return
    timestamp = message.get("created_at") or datetime.now(timezone.utc).isoformat()
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (id, chat_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    message["id"],
                    message["chat_id"],
                    message["role"],
                    message["content"],
                    timestamp,
                ),
            )
            conn.commit()


def list_messages(chat_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, chat_id, role, content, created_at
            FROM messages
            WHERE chat_id = ?
            ORDER BY created_at ASC
            """,
            (chat_id,),
        ).fetchall()
    return [
        {
            "id": row[0],
            "chat_id": row[1],
            "role": row[2],
            "content": row[3],
            "created_at": row[4],
        }
        for row in rows
    ]


def delete_chat(chat_id: str) -> None:
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
            conn.commit()


def delete_messages_by_ids(message_ids: list[str]) -> None:
    if not message_ids:
        return
    placeholders = ",".join("?" for _ in message_ids)
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.execute(
                f"DELETE FROM messages WHERE id IN ({placeholders})",
                message_ids,
            )
            conn.commit()


def _build_quote_excerpt(text: str | None, limit: int = 100) -> str:
    normalized = " ".join((text or "").split())
    if not normalized:
        return ""
    parts = re.split(r"(?<=[。！？；.!?;])\s*", normalized, maxsplit=1)
    sentence = parts[0].strip() if parts else normalized
    return sentence[:limit]


def add_citations(message_id: str, citations: list[dict]) -> None:
    if not message_id or not citations:
        return
    with _WRITE_LOCK:
        with _connect() as conn:
            conn.executemany(
                """
                INSERT INTO citations (message_id, chunk_id, rank, quote_text, score)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        message_id,
                        item.get("chunk_id"),
                        int(item.get("rank") or idx + 1),
                        _build_quote_excerpt(item.get("quote_text")),
                        item.get("score"),
                    )
                    for idx, item in enumerate(citations)
                ],
            )
            conn.commit()


def list_citations_by_message(message_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.message_id, c.chunk_id, c.rank, c.quote_text, c.score, f.filename
            FROM citations c
            LEFT JOIN chunks ch ON ch.id = c.chunk_id
            LEFT JOIN files f ON f.id = ch.file_id
            WHERE c.message_id = ?
            ORDER BY c.rank ASC, c.id ASC
            """,
            (message_id,),
        ).fetchall()
    return [
        {
            "id": row[0],
            "message_id": row[1],
            "chunk_id": row[2],
            "rank": row[3],
            "quote_text": row[4],
            "score": row[5],
            "file_name": row[6],
        }
        for row in rows
    ]


def get_chunk_by_id(chunk_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT c.id, c.file_id, f.filename, f.stored_path, c.text, c.order_idx
            FROM chunks c
            LEFT JOIN files f ON f.id = c.file_id
            WHERE c.id = ?
            """,
            (chunk_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "file_id": row[1],
        "file_name": row[2],
        "stored_path": row[3],
        "text": row[4],
        "order_idx": row[5],
    }


def list_chunks() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.file_id, f.filename, f.stored_path, c.text, c.order_idx
            FROM chunks c
            LEFT JOIN files f ON f.id = c.file_id
            """
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


def list_chunks_by_file_id(file_id: str, limit: int = 3) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.file_id, f.filename, f.stored_path, c.text, c.order_idx
            FROM chunks c
            LEFT JOIN files f ON f.id = c.file_id
            WHERE c.file_id = ?
            ORDER BY c.order_idx ASC
            LIMIT ?
            """,
            (file_id, limit),
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
