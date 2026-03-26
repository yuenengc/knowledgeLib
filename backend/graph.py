from __future__ import annotations

from typing import TypedDict, List, Any, Dict, Tuple, Optional, AsyncGenerator
import os
import json

from langgraph.graph import StateGraph, END
from llama_index.core import VectorStoreIndex
from llama_index.core import Settings
from llama_index.core.llms import ChatMessage
from llama_index.core.base.llms.types import MessageRole
from rank_bm25 import BM25Okapi
import jieba
import httpx

from .db import list_nodes
from .settings import is_llm_enabled


class SearchState(TypedDict):
    query: str
    top_k: int
    results: List[dict]
    answer: str
    usage: dict


def _extract_usage(resp: Any) -> dict:
    usage: Optional[dict] = None

    raw = getattr(resp, "raw", None)
    if isinstance(raw, dict):
        usage = raw.get("usage")
    elif hasattr(raw, "usage"):
        usage = getattr(raw, "usage")

    if usage is None and hasattr(resp, "usage"):
        usage = getattr(resp, "usage")

    if usage is None:
        additional = getattr(resp, "additional_kwargs", None)
        if isinstance(additional, dict):
            usage = additional.get("usage")

    if not isinstance(usage, dict):
        usage = {}

    context_window = os.getenv("LLM_CONTEXT_WINDOW") or os.getenv("MODEL_CONTEXT_WINDOW")
    limit = None
    if context_window:
        try:
            limit = int(context_window)
        except ValueError:
            limit = None

    if limit is not None:
        total_tokens = usage.get("total_tokens")
        if isinstance(total_tokens, int):
            usage["context_window"] = limit
            usage["remaining_tokens"] = max(limit - total_tokens, 0)

    return usage


def _openai_compat_chat(
    api_base: str,
    api_key: str,
    model: str,
    messages: list[dict],
    temperature: float = 0.1,
) -> tuple[str, dict]:
    url = api_base.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": temperature}
    resp = httpx.post(url, headers=headers, json=payload, timeout=60.0)
    resp.raise_for_status()
    data = resp.json()
    choices = data.get("choices") or []
    content = ""
    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content") or ""
    usage = data.get("usage") or {}
    return content, usage


def _build_prompt(query: str, results: List[dict]) -> Tuple[str, str]:
    sources = []
    for idx, item in enumerate(results, start=1):
        snippet = (item.get("text") or "").strip().replace("\n", " ")
        if len(snippet) > 800:
            snippet = snippet[:800] + "..."
        sources.append(f"[{idx}] {item.get('file_name')}\n{snippet}")

    system = (
        "你是企业知识库助手。仅使用提供的资料回答问题。"
        "用Markdown格式回答，关键内容加粗。"
        "如无法从资料得出答案，回答未找到相关信息。"
        "引用必须准确、简洁，不要长篇粘贴原文。"
    )
    user = (
        "问题：{query}\n\n资料：\n{sources}\n\n"
        "请严格使用Markdown输出，建议结构如下：\n"
        "### 答案\n"
        "- **要点1**：...\n"
        "- **要点2**：...\n\n"
        "### 引用\n"
        "- [1] 概括性出处（不超过30字）\n"
        "要求：\n"
        "1) 引用仅保留答案里实际用到的来源编号；未使用的编号不要出现。\n"
        "2) 引用内容必须是“出处+简述”，禁止粘贴长段原文。\n"
        "3) 答案中的引用标注需与引用列表一致，如[1][2]。\n"
    ).format(
        query=query,
        sources="\n\n".join(sources),
    )

    return system, user


def build_search_graph(index: VectorStoreIndex):
    bm25_cache: Dict[str, Any] = {
        "count": 0,
        "bm25": None,
        "nodes": [],
        "tokenized": [],
    }

    def _tokenize(text: str) -> List[str]:
        tokens = [t.strip() for t in jieba.lcut(text) if t.strip()]
        return tokens or text.split()

    def _get_bm25() -> Tuple[BM25Okapi | None, List[dict], List[List[str]]]:
        nodes = list_nodes()
        if not nodes:
            return None, [], []
        if bm25_cache["count"] != len(nodes):
            tokenized = [_tokenize(n["text"]) for n in nodes]
            bm25_cache["bm25"] = BM25Okapi(tokenized)
            bm25_cache["nodes"] = nodes
            bm25_cache["tokenized"] = tokenized
            bm25_cache["count"] = len(nodes)
        return bm25_cache["bm25"], bm25_cache["nodes"], bm25_cache["tokenized"]

    def _merge_results(
        items: List[dict],
        max_per_file: int = 3,
        max_chars: int = 1800,
        min_score: float = 0.01,
    ) -> List[dict]:
        seen = set()
        grouped: Dict[str, dict] = {}

        for item in items:
            if (item.get("score") or 0.0) < min_score:
                continue
            text = (item.get("text") or "").strip()
            if not text:
                continue
            key = (item.get("file_id") or "") + "|" + text[:200]
            if key in seen:
                continue
            seen.add(key)

            file_id = item.get("file_id") or "unknown"
            entry = grouped.get(file_id)
            if entry is None:
                grouped[file_id] = {
                    "score": item.get("score", 0.0),
                    "file_name": item.get("file_name"),
                    "file_id": file_id,
                    "source_path": item.get("source_path"),
                    "_items": [
                        {
                            "text": text,
                            "order_idx": item.get("order_idx"),
                            "score": item.get("score", 0.0),
                        }
                    ],
                }
            else:
                if len(entry["_items"]) >= max_per_file:
                    continue
                entry["_items"].append(
                    {
                        "text": text,
                        "order_idx": item.get("order_idx"),
                        "score": item.get("score", 0.0),
                    }
                )
                entry["score"] = max(entry["score"], item.get("score", 0.0))

        merged = []
        for entry in grouped.values():
            items_sorted = sorted(
                entry["_items"],
                key=lambda x: (x["order_idx"] is None, x["order_idx"] or 0),
            )
            merged_text = ""
            for it in items_sorted:
                candidate = (merged_text + "\n\n" + it["text"]).strip()
                if not merged_text:
                    candidate = it["text"]
                if len(candidate) > max_chars:
                    break
                merged_text = candidate
            merged.append(
                {
                    "score": entry["score"],
                    "text": merged_text,
                    "file_name": entry.get("file_name"),
                    "file_id": entry.get("file_id"),
                    "source_path": entry.get("source_path"),
                }
            )

        return sorted(merged, key=lambda x: x["score"], reverse=True)

    def retrieve(state: SearchState) -> dict:
        top_k = state["top_k"]
        query = state["query"]

        retriever = index.as_retriever(similarity_top_k=max(top_k * 2, 5))
        vector_nodes = retriever.retrieve(query)

        bm25, bm25_nodes, _ = _get_bm25()
        bm25_ranked = []
        if bm25 is not None:
            scores = bm25.get_scores(_tokenize(query))
            bm25_ranked = sorted(
                enumerate(scores), key=lambda x: x[1], reverse=True
            )[: max(top_k * 2, 5)]

        fused: Dict[str, dict] = {}
        rrf_k = 60.0

        for rank, node in enumerate(vector_nodes, start=1):
            node_id = getattr(node, "node_id", None) or getattr(node, "id_", None) or str(rank)
            metadata = getattr(node, "metadata", {}) or {}
            item = fused.setdefault(
                node_id,
                {
                    "score": 0.0,
                    "text": node.get_content() if hasattr(node, "get_content") else str(node),
                    "file_name": metadata.get("file_name"),
                    "file_id": metadata.get("file_id"),
                    "source_path": metadata.get("stored_path"),
                    "order_idx": metadata.get("order_idx"),
                },
            )
            item["score"] += 1.0 / (rrf_k + rank)

        for rank, (idx, _score) in enumerate(bm25_ranked, start=1):
            n = bm25_nodes[idx]
            node_id = n["id"]
            item = fused.setdefault(
                node_id,
                {
                    "score": 0.0,
                    "text": n["text"],
                    "file_name": n["file_name"],
                    "file_id": n["file_id"],
                    "source_path": n["stored_path"],
                    "order_idx": n.get("order_idx"),
                },
            )
            item["score"] += 1.0 / (rrf_k + rank)

        results = sorted(fused.values(), key=lambda x: x["score"], reverse=True)[: max(top_k * 2, 6)]
        merged = _merge_results(results)
        return {"results": merged[:top_k]}

    def generate_answer(state: SearchState) -> dict:
        results = state["results"]
        if not results:
            return {"answer": "", "usage": {}}
        if not is_llm_enabled():
            return {
                "answer": "### 答案\nLLM 未启用，请检查 `DEEPSEEK_API_KEY` 是否正确加载，并重启后端。",
                "usage": {},
            }

        system, user = _build_prompt(state["query"], results)

        try:
            api_key = os.getenv("DEEPSEEK_API_KEY") or ""
            api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")
            model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            content, usage = _openai_compat_chat(
                api_base=api_base,
                api_key=api_key,
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            answer_text = content or ""
            if answer_text and not any(token in answer_text for token in ("#", "**", "- ", "1. ", "|")):
                raw = answer_text.strip()
                parts = [
                    p.strip()
                    for p in raw.replace("。", "。\n").replace("！", "！\n").replace("？", "？\n").split("\n")
                ]
                parts = [p for p in parts if p]
                if len(parts) <= 1:
                    answer_text = "### 答案\n" + raw
                else:
                    bullets = "\n".join(f"- **要点{idx + 1}**：{p}" for idx, p in enumerate(parts))
                    answer_text = "### 答案\n" + bullets
        except Exception as exc:
            print(f"[answer] LLM failed: {exc}")
            answer_text = f"### 答案\nLLM 调用失败：{exc}"
            usage = {}

        return {"answer": answer_text, "usage": usage}

    def _extract_usage(resp: Any) -> dict:
        usage: Optional[dict] = None

        raw = getattr(resp, "raw", None)
        if isinstance(raw, dict):
            usage = raw.get("usage")
        elif hasattr(raw, "usage"):
            usage = getattr(raw, "usage")

        if usage is None and hasattr(resp, "usage"):
            usage = getattr(resp, "usage")

        if usage is None:
            additional = getattr(resp, "additional_kwargs", None)
            if isinstance(additional, dict):
                usage = additional.get("usage")

        if not isinstance(usage, dict):
            usage = {}

        context_window = os.getenv("LLM_CONTEXT_WINDOW") or os.getenv("MODEL_CONTEXT_WINDOW")
        limit = None
        if context_window:
            try:
                limit = int(context_window)
            except ValueError:
                limit = None

        if limit is not None:
            total_tokens = usage.get("total_tokens")
            if isinstance(total_tokens, int):
                usage["context_window"] = limit
                usage["remaining_tokens"] = max(limit - total_tokens, 0)

        return usage

    graph = StateGraph(SearchState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("generate_answer", generate_answer)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "generate_answer")
    graph.add_edge("generate_answer", END)
    return graph.compile()


def run_search(index: VectorStoreIndex, query: str, top_k: int) -> dict:
    graph = build_search_graph(index)
    state = {"query": query, "top_k": top_k}
    result = graph.invoke(state)
    return {
        "results": result.get("results", []),
        "answer": result.get("answer", ""),
        "usage": result.get("usage", {}),
    }


async def stream_answer(query: str, results: List[dict]) -> AsyncGenerator[dict, None]:
    if not results:
        return
    if not is_llm_enabled():
        yield {
            "type": "delta",
            "content": "### 答案\nLLM 未启用，请检查 `DEEPSEEK_API_KEY` 是否正确加载，并重启后端。",
        }
        yield {"type": "usage", "usage": {}}
        return

    system, user = _build_prompt(query, results)
    api_key = os.getenv("DEEPSEEK_API_KEY") or ""
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    url = api_base.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
        "stream": True,
    }

    usage: dict = {}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(chunk, dict) and chunk.get("usage"):
                        usage = chunk["usage"]
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield {"type": "delta", "content": content}
    except Exception as exc:
        yield {"type": "delta", "content": f"### 答案\nLLM 调用失败：{exc}"}
        yield {"type": "usage", "usage": {}}
        return

    if usage:
        yield {"type": "usage", "usage": usage}
