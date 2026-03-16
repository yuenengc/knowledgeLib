from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
import httpx
from llama_index.core import Settings
from llama_index.llms.openai import OpenAI
from llama_index.embeddings.huggingface import HuggingFaceEmbedding


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def configure_llm() -> None:
    load_dotenv(dotenv_path=ROOT_DIR / ".env")

    api_key = _env("DEEPSEEK_API_KEY")
    api_base = _env("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")
    model = _env("DEEPSEEK_MODEL", "deepseek-chat")
    embed_model = _env("HF_EMBED_MODEL", "BAAI/bge-small-zh-v1.5")

    # Always set local embedding model, even if LLM is not configured.
    Settings.embed_model = HuggingFaceEmbedding(model_name=embed_model)

    if not api_key:
        return

    # Ensure OpenAI-compatible env vars are set for underlying clients.
    # Use hard assignment to avoid stale system env overriding .env.
    os.environ["OPENAI_API_KEY"] = api_key
    os.environ["OPENAI_API_BASE"] = api_base
    os.environ["OPENAI_BASE_URL"] = api_base

    def _log_request(request: httpx.Request) -> None:
        print(f"[openai] {request.method} {request.url}")

    http_client = httpx.Client(event_hooks={"request": [_log_request]})

    Settings.llm = OpenAI(
        api_key=api_key,
        api_base=api_base,
        model=model,
        temperature=0.1,
        http_client=http_client,
    )

    # LLM is optional; embeddings already configured above.


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(_env("DATA_DIR", str(ROOT_DIR / "data")))
UPLOAD_DIR = Path(_env("UPLOAD_DIR", str(DATA_DIR / "uploads")))
CHROMA_DIR = Path(_env("CHROMA_DIR", str(ROOT_DIR / "chroma_db")))


for _path in (DATA_DIR, UPLOAD_DIR, CHROMA_DIR):
    _path.mkdir(parents=True, exist_ok=True)
