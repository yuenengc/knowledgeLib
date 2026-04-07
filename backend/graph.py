from __future__ import annotations

from typing import TypedDict, List, Dict, Tuple, AsyncGenerator
import os
import json

from langgraph.graph import StateGraph, END
from llama_index.core import VectorStoreIndex
from rank_bm25 import BM25Okapi
import jieba
import httpx

from .db import list_chunks
from .settings import is_llm_enabled, get_embed_query_prefix


class SearchState(TypedDict):
    query: str
    top_k: int
    results: List[dict]


def _build_prompt(query: str, results: List[dict]) -> Tuple[str, str]:
    sources = []
    for idx, item in enumerate(results, start=1):
        snippet = (item.get("text") or "").strip().replace("\n", " ")
        if len(snippet) > 800:
            snippet = snippet[:800] + "..."
        sources.append(f"[{idx}] {item.get('file_name')}\n{snippet}")

    system = (
        "你是企业知识库助手。你的回答必须严格基于提供的资料。"
        "如果资料不足以回答问题，直接说明未找到相关信息。"
        "禁止编造、补充或使用未提供的资料。"
        "用Markdown输出，关键内容加粗，语气简洁清晰。"
        "引用必须准确、简洁，不要粘贴长段原文。"
    )
    user = (
        "任务：回答用户问题，仅依据资料。\n"
        "输出格式（必须遵守）：\n"
        "### 答案\n"
        "- **要点1**：... [1]\n"
        "- **要点2**：... [2]\n\n"
        "### 引用\n"
        "- [1] 出处+简述（不超过30字）\n"
        "- [2] 出处+简述（不超过30字）\n\n"
        "规则：\n"
        "1) 只保留答案里实际引用到的编号；未使用的编号不要出现。\n"
        "2) 引用内容必须是“出处+简述”，禁止粘贴长段原文。\n"
        "3) 答案中的引用标注需与引用列表一致，如[1][2]。\n"
        "4) 若资料不足，请只输出：\n"
        "### 答案\n"
        "未找到相关信息。\n"
        "### 引用\n"
        "- 无\n\n"
        "问题：\n"
        "<<<{query}>>>\n\n"
        "资料：\n"
        "<<<\n"
        "{sources}\n"
        ">>>\n"
    ).format(
        query=query,
        sources="\n\n".join(sources),
    )

    return system, user


def build_search_graph(index: VectorStoreIndex):
    bm25_cache = {
        "count": 0,
        "bm25": None,
        "chunks": [],
        "tokenized": [],
    }

    def _tokenize(text: str) -> List[str]:
        tokens = [t.strip() for t in jieba.lcut(text) if t.strip()]
        return tokens or text.split()

    def _get_bm25() -> Tuple[BM25Okapi | None, List[dict], List[List[str]]]:
        chunks = list_chunks()
        if not chunks:
            return None, [], []
        if bm25_cache["count"] != len(chunks):
            tokenized = [_tokenize(chunk["text"]) for chunk in chunks]
            bm25_cache["bm25"] = BM25Okapi(tokenized)
            bm25_cache["chunks"] = chunks
            bm25_cache["tokenized"] = tokenized
            bm25_cache["count"] = len(chunks)
        return bm25_cache["bm25"], bm25_cache["chunks"], bm25_cache["tokenized"]

    def _merge_results(
        items: List[dict],
        max_per_file: int = 1,
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
                            "chunk_id": item.get("chunk_id"),
                        }
                    ],
                }
            else:
                if len(entry["_items"]) < max_per_file:
                    entry["_items"].append(
                        {
                            "text": text,
                            "order_idx": item.get("order_idx"),
                            "score": item.get("score", 0.0),
                            "chunk_id": item.get("chunk_id"),
                        }
                    )
                entry["score"] = max(entry["score"], item.get("score", 0.0))

        merged = []
        for entry in grouped.values():
            items_sorted = sorted(
                entry["_items"],
                key=lambda x: (-x["score"], x["order_idx"] is None, x["order_idx"] or 0),
            )
            merged_text = ""
            if items_sorted:
                merged_text = items_sorted[0]["text"][:max_chars]
            merged.append(
                {
                    "score": entry["score"],
                    "text": merged_text,
                    "file_name": entry.get("file_name"),
                    "file_id": entry.get("file_id"),
                    "source_path": entry.get("source_path"),
                    "chunk_id": items_sorted[0].get("chunk_id") if items_sorted else None,
                }
            )

        return sorted(merged, key=lambda x: x["score"], reverse=True)

    def retrieve(state: SearchState) -> dict:
        top_k = state["top_k"]
        query = state["query"]
        prefix = get_embed_query_prefix()
        vector_query = f"{prefix}{query}" if prefix else query

        retriever = index.as_retriever(similarity_top_k=max(top_k * 2, 5))
        vector_nodes = retriever.retrieve(vector_query)

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
                    "chunk_id": node_id,
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
                    "chunk_id": n["id"],
                },
            )
            item["score"] += 1.0 / (rrf_k + rank)

        results = sorted(fused.values(), key=lambda x: x["score"], reverse=True)[: max(top_k * 2, 6)]
        merged = _merge_results(results)
        return {"results": merged[:top_k]}

    graph = StateGraph(SearchState)
    graph.add_node("retrieve", retrieve)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", END)
    return graph.compile()


def run_search(index: VectorStoreIndex, query: str, top_k: int) -> dict:
    graph = build_search_graph(index)
    state = {"query": query, "top_k": top_k}
    result = graph.invoke(state)
    return {
        "results": result.get("results", []),
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
