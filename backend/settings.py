from __future__ import annotations

import os
from pathlib import Path
import tempfile

from dotenv import load_dotenv
import httpx
from llama_index.core import Settings
try:
    from llama_index.llms.openai_like import OpenAILike
    _OPENAI_LIKE_AVAILABLE = True
except Exception:
    OpenAILike = None  # type: ignore
    _OPENAI_LIKE_AVAILABLE = False
from llama_index.llms.openai import OpenAI
from llama_index.embeddings.fastembed import FastEmbedEmbedding


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


LLM_ENABLED = False
_LLM_CONFIG: dict[str, str | None] = {"api_base": None, "model": None, "llm_class": None}
_EMBED_QUERY_PREFIX: str | None = None
CHAT_MAX_MESSAGES = int(_env("CHAT_MAX_MESSAGES", "20") or 20)
CHAT_MAX_TOKENS = int(_env("CHAT_MAX_TOKENS", "4000") or 4000)
CHAT_SUMMARY_WINDOW = int(_env("CHAT_SUMMARY_WINDOW", "10") or 10)
CHAT_WARN_RATIO = float(_env("CHAT_WARN_RATIO", "0.8") or 0.8)
CHAT_MAX_SESSIONS = int(_env("CHAT_MAX_SESSIONS", "5") or 5)


def configure_llm() -> None:
    global LLM_ENABLED
    global _LLM_CONFIG
    global _EMBED_QUERY_PREFIX
    load_dotenv(dotenv_path=ROOT_DIR / ".env")

    api_key = _env("DEEPSEEK_API_KEY")
    api_base = _env("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")
    model = _env("DEEPSEEK_MODEL", "deepseek-chat")
    embed_model = _env("HF_EMBED_MODEL", "BAAI/bge-small-zh-v1.5")
    _EMBED_QUERY_PREFIX = _env("EMBED_QUERY_PREFIX")
    _LLM_CONFIG = {"api_base": api_base, "model": model, "llm_class": None}

    # Always set local embedding model, even if LLM is not configured.
    Settings.embed_model = FastEmbedEmbedding(model_name=embed_model)

    if not api_key:
        LLM_ENABLED = False
        return

    # Ensure OpenAI-compatible env vars are set for underlying clients.
    # Use hard assignment to avoid stale system env overriding .env.
    os.environ["OPENAI_API_KEY"] = api_key
    os.environ["OPENAI_API_BASE"] = api_base
    os.environ["OPENAI_BASE_URL"] = api_base

    def _log_request(request: httpx.Request) -> None:
        print(f"[openai] {request.method} {request.url}")

    http_client = httpx.Client(event_hooks={"request": [_log_request]})

    if _OPENAI_LIKE_AVAILABLE and OpenAILike is not None:
        Settings.llm = OpenAILike(
            api_key=api_key,
            api_base=api_base,
            model=model,
            temperature=0.1,
            http_client=http_client,
        )
        _LLM_CONFIG["llm_class"] = "OpenAILike"
    else:
        Settings.llm = OpenAI(
            api_key=api_key,
            api_base=api_base,
            model=model,
            temperature=0.1,
            http_client=http_client,
        )
        _LLM_CONFIG["llm_class"] = "OpenAI"
    LLM_ENABLED = True

    # LLM is optional; embeddings already configured above.


def is_llm_enabled() -> bool:
    return LLM_ENABLED


def get_llm_config() -> dict:
    return {
        "enabled": LLM_ENABLED,
        "api_base": _LLM_CONFIG.get("api_base"),
        "model": _LLM_CONFIG.get("model"),
        "llm_class": _LLM_CONFIG.get("llm_class"),
    }


def get_embed_query_prefix() -> str | None:
    return _EMBED_QUERY_PREFIX


ROOT_DIR = Path(__file__).resolve().parent

def _default_data_dir() -> Path:
    # On some Windows/networked drives, SQLite file locking can fail (disk I/O error).
    # Prefer a per-user local directory by default on Windows to be robust.
    if os.name == "nt":
        candidates = [os.getenv("LOCALAPPDATA"), tempfile.gettempdir()]
        for base in candidates:
            if not base:
                continue
            path = Path(base) / "knowledge-lib"
            try:
                path.mkdir(parents=True, exist_ok=True)
                return path
            except Exception:
                continue
        return ROOT_DIR / "data"
    return ROOT_DIR / "data"


DATA_DIR = Path(_env("DATA_DIR", str(_default_data_dir())))
UPLOAD_DIR = Path(_env("UPLOAD_DIR", str(DATA_DIR / "uploads")))
CHROMA_DIR = Path(_env("CHROMA_DIR", str(DATA_DIR / "chroma_db")))


for _path in (DATA_DIR, UPLOAD_DIR, CHROMA_DIR):
    _path.mkdir(parents=True, exist_ok=True)
