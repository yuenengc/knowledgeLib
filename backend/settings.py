from __future__ import annotations

import logging
import os
import shutil
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

logger = logging.getLogger("knowledge-lib.settings")

ROOT_DIR = Path(__file__).resolve().parent

# Load .env before computing any path defaults so CHROMA_DIR / DATA_DIR can be
# overridden from the environment at process start.
load_dotenv(dotenv_path=ROOT_DIR / ".env")


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


LLM_ENABLED = False
_LLM_CONFIG: dict[str, str | None] = {"api_base": None, "model": None, "llm_class": None}
_EMBED_QUERY_PREFIX: str | None = None
_EMBED_MODEL_CONFIGURED = False
_EMBED_MODEL_NAME: str | None = None
CHAT_MAX_MESSAGES = int(_env("CHAT_MAX_MESSAGES", "40") or 40)
CHAT_MAX_TOKENS = int(_env("CHAT_MAX_TOKENS", "4000") or 4000)
CHAT_SUMMARY_WINDOW = int(_env("CHAT_SUMMARY_WINDOW", "10") or 10)
CHAT_WARN_RATIO = float(_env("CHAT_WARN_RATIO", "0.8") or 0.8)
CHAT_MAX_SESSIONS = int(_env("CHAT_MAX_SESSIONS", "10") or 10)

RRF_K = int(_env("RRF_K", "60") or 60)

SEARCH_BM25_TOP_K = int(_env("SEARCH_BM25_TOP_K", "10") or 10)
SEARCH_VECTOR_TOP_K = int(_env("SEARCH_VECTOR_TOP_K", "10") or 10)
SEARCH_RRF_TOP_K = int(_env("SEARCH_RRF_TOP_K", "5") or 5)
SEARCH_RERANK_TOP_K = int(_env("SEARCH_RERANK_TOP_K", "4") or 4)
SEARCH_LLM_TOP_K = int(_env("SEARCH_LLM_TOP_K", "3") or 3)
SEARCH_RERANK_THRESHOLD = float(_env("SEARCH_RERANK_THRESHOLD", "0.55") or 0.55)
SEARCH_RERANK_MODEL = _env("SEARCH_RERANK_MODEL", "BAAI/bge-reranker-base")


def configure_llm() -> None:
    global LLM_ENABLED
    global _LLM_CONFIG
    global _EMBED_QUERY_PREFIX
    load_dotenv(dotenv_path=ROOT_DIR / ".env")

    api_key = _env("DEEPSEEK_API_KEY")
    api_base = _env("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")
    model = _env("DEEPSEEK_MODEL", "deepseek-chat")
    _EMBED_QUERY_PREFIX = _env("EMBED_QUERY_PREFIX")
    _LLM_CONFIG = {"api_base": api_base, "model": model, "llm_class": None}

    configure_embeddings()

    if not api_key:
        LLM_ENABLED = False
        return

    # Ensure OpenAI-compatible env vars are set for underlying clients.
    # Use hard assignment to avoid stale system env overriding .env.
    os.environ["OPENAI_API_KEY"] = api_key
    os.environ["OPENAI_API_BASE"] = api_base
    os.environ["OPENAI_BASE_URL"] = api_base

    def _log_request(request: httpx.Request) -> None:
        logger.info("[openai] %s %s", request.method, request.url)

    http_client = httpx.Client(event_hooks={"request": [_log_request]})

    if _OPENAI_LIKE_AVAILABLE and OpenAILike is not None:
        Settings.llm = OpenAILike(
            api_key=api_key,
            api_base=api_base,
            model=model,
            temperature=0,
            top_p=1,
            http_client=http_client,
        )
        _LLM_CONFIG["llm_class"] = "OpenAILike"
    else:
        Settings.llm = OpenAI(
            api_key=api_key,
            api_base=api_base,
            model=model,
            temperature=0,
            top_p=1,
            http_client=http_client,
        )
        _LLM_CONFIG["llm_class"] = "OpenAI"
    LLM_ENABLED = True

    # LLM is optional; embeddings already configured above.


def configure_embeddings() -> None:
    global _EMBED_MODEL_CONFIGURED
    global _EMBED_MODEL_NAME
    if _EMBED_MODEL_CONFIGURED:
        return

    embed_model = _env("HF_EMBED_MODEL", "BAAI/bge-small-zh-v1.5")
    # Import lazily so the heavy embedding backend is only loaded when needed.
    from llama_index.embeddings.fastembed import FastEmbedEmbedding

    try:
        Settings.embed_model = FastEmbedEmbedding(model_name=embed_model)
    except ValueError as exc:
        if not _repair_fastembed_cache(exc):
            raise
        logger.warning("Rebuilding fastembed cache for model=%s after cache repair", embed_model)
        Settings.embed_model = FastEmbedEmbedding(model_name=embed_model)
    _EMBED_MODEL_CONFIGURED = True
    _EMBED_MODEL_NAME = embed_model


def _repair_fastembed_cache(exc: ValueError) -> bool:
    message = str(exc)
    marker = "Could not find tokenizer_config.json in "
    if marker not in message:
        return False

    snapshot_dir = Path(message.split(marker, 1)[1].strip())
    model_cache_dir = snapshot_dir
    if snapshot_dir.name and snapshot_dir.parent.name == "snapshots":
        model_cache_dir = snapshot_dir.parent.parent

    try:
        shutil.rmtree(model_cache_dir)
    except FileNotFoundError:
        return True
    except Exception:
        logger.exception("Failed to remove corrupted fastembed cache path=%s", model_cache_dir)
        return False

    logger.warning("Removed corrupted fastembed cache path=%s", model_cache_dir)
    return True


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
