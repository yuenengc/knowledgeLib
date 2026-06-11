from __future__ import annotations

from typing import TypedDict, List, Dict, Tuple, AsyncGenerator
import logging
import os
import json
import ast
import math
import time
import threading

from langgraph.graph import StateGraph, END
from llama_index.core import VectorStoreIndex
from rank_bm25 import BM25Okapi
import jieba
import httpx

from .db import get_chunk_by_id, list_chunks
from .settings import (
    is_llm_enabled,
    get_embed_query_prefix,
    SEARCH_BM25_TOP_K,
    SEARCH_VECTOR_TOP_K,
    SEARCH_RRF_TOP_K,
    SEARCH_RERANK_TOP_K,
    SEARCH_LLM_TOP_K,
    SEARCH_RERANK_THRESHOLD,
    SEARCH_RERANK_MODEL,
    RRF_K,
)

try:
    from sentence_transformers import CrossEncoder
except Exception:  # pragma: no cover - optional dependency fallback
    CrossEncoder = None  # type: ignore

logger = logging.getLogger("knowledge-lib.search")
LOG_PREFIX = "----logger   "
_RERANKER = None
_BM25_LOCK = threading.Lock()
_BM25_CACHE: dict[str, object] = {
    "signature": None,
    "bm25": None,
    "chunks": [],
    "tokenized": [],
}


class SearchState(TypedDict):
    query: str
    results: List[dict]
    stage_results: dict


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
    def _snip(text: str, max_len: int = 200) -> str:
        value = (text or "").strip().replace("\n", " ")
        if len(value) > max_len:
            return value[:max_len] + "..."
        return value

    def _log_hit(stage: str, rank: int, item: dict, extra: str = "") -> None:
        logger.info(
            LOG_PREFIX
            + "[hits.%s] #%s score=%s rerank_score=%s rerank_score_raw=%s file_id=%s file=%s chunk_id=%s text=%s%s",
            stage,
            rank,
            item.get("score"),
            item.get("rerank_score"),
            item.get("rerank_score_raw"),
            item.get("file_id"),
            item.get("file_name"),
            item.get("chunk_id"),
            _snip(item.get("text") or ""),
            extra,
        )

    def _tokenize(text: str) -> List[str]:
        tokens = [t.strip() for t in jieba.lcut(text) if t.strip()]
        return tokens or text.split()

    def _get_bm25() -> Tuple[BM25Okapi | None, List[dict], List[List[str]]]:
        t0 = time.perf_counter()
        chunks = list_chunks()
        list_ms = (time.perf_counter() - t0) * 1000
        signature = tuple(
            (chunk.get("id"), chunk.get("parent_id"), len(chunk.get("text") or ""))
            for chunk in chunks
        )
        if not chunks:
            logger.info(LOG_PREFIX + "[timing.bm25] list_chunks_ms=%.1f chunks=0 cache_rebuilt=0 total_ms=%.1f", list_ms, (time.perf_counter() - t0) * 1000)
            return None, [], []

        with _BM25_LOCK:
            rebuilt = False
            if _BM25_CACHE.get("signature") != signature:
                build_t0 = time.perf_counter()
                tokenized = [_tokenize(chunk["text"]) for chunk in chunks]
                _BM25_CACHE["bm25"] = BM25Okapi(tokenized)
                _BM25_CACHE["chunks"] = chunks
                _BM25_CACHE["tokenized"] = tokenized
                _BM25_CACHE["signature"] = signature
                rebuilt = True
                logger.info(LOG_PREFIX + "[timing.bm25] tokenize_build_ms=%.1f chunks=%s", (time.perf_counter() - build_t0) * 1000, len(chunks))
            logger.info(
                LOG_PREFIX + "[timing.bm25] list_chunks_ms=%.1f chunks=%s cache_rebuilt=%s total_ms=%.1f",
                list_ms,
                len(chunks),
                int(rebuilt),
                (time.perf_counter() - t0) * 1000,
            )
            return (
                _BM25_CACHE["bm25"],  # type: ignore[return-value]
                _BM25_CACHE["chunks"],  # type: ignore[return-value]
                _BM25_CACHE["tokenized"],  # type: ignore[return-value]
            )

    def _get_reranker():
        global _RERANKER
        if _RERANKER is None and CrossEncoder is not None:
            t0 = time.perf_counter()
            _RERANKER = CrossEncoder(SEARCH_RERANK_MODEL)
            logger.info(LOG_PREFIX + "[timing.reranker] load_ms=%.1f model=%s", (time.perf_counter() - t0) * 1000, SEARCH_RERANK_MODEL)
        return _RERANKER

    def _merge_results(
        items: List[dict],
        max_chars: int = 5000,
        min_score: float = 0.01,
    ) -> List[dict]:
        seen = set()
        merged = []
        for item in items:
            if (item.get("score") or 0.0) < min_score:
                continue
            text = (item.get("text") or "").strip()
            if not text:
                continue
            chunk_id = item.get("chunk_id") or ""
            key = chunk_id or ((item.get("file_id") or "") + "|" + text[:200])
            if key in seen:
                continue
            seen.add(key)
            merged.append(
                {
                    "score": item.get("score", 0.0),
                    "rerank_score": item.get("rerank_score", 0.0),
                    "text": text[:max_chars],
                    "file_name": item.get("file_name"),
                    "file_id": item.get("file_id"),
                    "source_path": item.get("source_path"),
                    "chunk_id": item.get("chunk_id"),
                    "parent_id": item.get("parent_id"),
                }
            )

        return sorted(merged, key=lambda x: x["score"], reverse=True)

    def _expand_to_parent_results(items: List[dict]) -> List[dict]:
        expanded: List[dict] = []
        seen_parent_ids = set()
        parent_cache: Dict[str, dict | None] = {}

        def _parent_for(item: dict) -> dict:
            parent_id = item.get("parent_id") or item.get("chunk_id")
            if not parent_id:
                return item
            if parent_id not in parent_cache:
                parent_cache[parent_id] = get_chunk_by_id(parent_id)
            parent = parent_cache[parent_id]
            if not parent:
                return item
            return {
                **item,
                "chunk_id": parent["id"],
                "text": parent.get("text") or item.get("text") or "",
                "order_idx": parent.get("order_idx"),
                "file_id": parent.get("file_id") or item.get("file_id"),
                "file_name": parent.get("file_name") or item.get("file_name"),
                "source_path": parent.get("stored_path") or item.get("source_path"),
                "parent_id": parent["id"],
            }

        for item in items:
            parent_item = _parent_for(item)
            parent_key = parent_item.get("chunk_id") or parent_item.get("parent_id")
            if not parent_key or parent_key in seen_parent_ids:
                continue
            seen_parent_ids.add(parent_key)
            expanded.append(parent_item)

        return expanded

    def _extract_text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("{") and stripped.endswith("}"):
                try:
                    parsed = ast.literal_eval(stripped)
                except Exception:
                    parsed = None
                if isinstance(parsed, dict):
                    nested = parsed.get("text") or parsed.get("content")
                    if nested is not None:
                        extracted = _extract_text(nested)
                        if extracted:
                            return extracted
            return value
        if isinstance(value, dict):
            nested = value.get("text") or value.get("content")
            if isinstance(nested, str) and nested.strip():
                return nested
            if nested is not None:
                extracted = _extract_text(nested)
                if extracted:
                    return extracted
            return str(value)
        if hasattr(value, "text") and getattr(value, "text", None) is not None:
            extracted = _extract_text(getattr(value, "text"))
            if extracted:
                return extracted
        if hasattr(value, "get_content"):
            try:
                content = value.get_content()
                if content and content != str(value):
                    extracted = _extract_text(content)
                    if extracted:
                        return extracted
            except Exception:
                pass
        return str(value)

    def retrieve(state: SearchState) -> dict:
        retrieve_t0 = time.perf_counter()
        query = state["query"]
        prefix = get_embed_query_prefix()
        vector_query = f"{prefix}{query}" if prefix else query

        def _unwrap_vector_node(obj):
            # llama-index retrievers typically return NodeWithScore(node=..., score=float).
            base = getattr(obj, "node", None) or obj
            score = getattr(obj, "score", None)
            return base, score

        def _node_id(base) -> str:
            return (
                getattr(base, "node_id", None)
                or getattr(base, "id_", None)
                or getattr(base, "id", None)
                or "unknown"
            )

        def _metadata(base) -> dict:
            meta = getattr(base, "metadata", None)
            return meta if isinstance(meta, dict) else {}

        def _child_content(base) -> str:
            text = getattr(base, "text", None)
            return text.strip() if isinstance(text, str) and text.strip() else ""

        logger.info(
            LOG_PREFIX + "[retrieve] query=%s vector_query=%s llm_top_k=%s",
            query,
            vector_query,
            SEARCH_LLM_TOP_K,
        )

        stage_t0 = time.perf_counter()
        retriever = index.as_retriever(similarity_top_k=max(SEARCH_VECTOR_TOP_K, 5))
        vector_nodes = retriever.retrieve(vector_query)
        logger.info(LOG_PREFIX + "[timing.retrieve] vector_retrieve_ms=%.1f raw_count=%s", (time.perf_counter() - stage_t0) * 1000, len(vector_nodes))

        stage_t0 = time.perf_counter()
        bm25, bm25_nodes, _ = _get_bm25()
        logger.info(LOG_PREFIX + "[timing.retrieve] bm25_get_ms=%.1f nodes=%s", (time.perf_counter() - stage_t0) * 1000, len(bm25_nodes))
        bm25_ranked = []
        if bm25 is not None:
            stage_t0 = time.perf_counter()
            scores = bm25.get_scores(_tokenize(query))
            bm25_ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[:SEARCH_BM25_TOP_K]
            logger.info(LOG_PREFIX + "[timing.retrieve] bm25_score_sort_ms=%.1f ranked=%s", (time.perf_counter() - stage_t0) * 1000, len(bm25_ranked))

        # Log raw hits: vector vs keyword (BM25)
        logger.info(LOG_PREFIX + "[hits.vector] count=%s", len(vector_nodes))
        vector_stage_results: List[dict] = []
        for i, obj in enumerate(vector_nodes[:SEARCH_VECTOR_TOP_K], start=1):
            base, score = _unwrap_vector_node(obj)
            meta = _metadata(base)
            item = {
                "score": score,
                "file_id": meta.get("file_id"),
                "file_name": meta.get("file_name"),
                "chunk_id": _node_id(base),
                "parent_id": meta.get("parent_id"),
                "text": _child_content(base),
            }
            vector_stage_results.append(item)
            _log_hit(
                "vector",
                i,
                item,
                extra=f" type={type(base).__name__}",
            )

        logger.info(LOG_PREFIX + "[hits.bm25] count=%s", len(bm25_ranked))
        bm25_stage_results: List[dict] = []
        for i, (idx, score) in enumerate(bm25_ranked[:SEARCH_BM25_TOP_K], start=1):
            item = bm25_nodes[idx]
            stage_item = {
                "score": float(score),
                "file_id": item.get("file_id"),
                "file_name": item.get("file_name"),
                "chunk_id": item.get("id"),
                "text": item.get("text") or "",
            }
            bm25_stage_results.append(stage_item)
            _log_hit(
                "bm25",
                i,
                stage_item,
            )

        fused: Dict[str, dict] = {}

        stage_t0 = time.perf_counter()
        for rank, obj in enumerate(vector_nodes, start=1):
            base, _score = _unwrap_vector_node(obj)
            metadata = _metadata(base)
            source_chunk_id = _node_id(base)
            item = fused.setdefault(
                source_chunk_id,
                {
                    "score": 0.0,
                    "text": _child_content(base),
                    "file_name": metadata.get("file_name"),
                    "file_id": metadata.get("file_id"),
                    "source_path": metadata.get("stored_path"),
                    "order_idx": metadata.get("order_idx"),
                    "chunk_id": source_chunk_id,
                    "parent_id": metadata.get("parent_id"),
                },
            )
            item["score"] += 1.0 / (RRF_K + rank)

        for rank, (idx, _score) in enumerate(bm25_ranked, start=1):
            n = bm25_nodes[idx]
            node_id = n["id"]
            text_for_rrf = n.get("text") or ""
            item = fused.setdefault(
                node_id,
                {
                    "score": 0.0,
                    "text": text_for_rrf,
                    "file_name": n["file_name"],
                    "file_id": n["file_id"],
                    "source_path": n["stored_path"],
                    "order_idx": n.get("order_idx"),
                    "chunk_id": node_id,
                    "parent_id": n.get("parent_id"),
                },
            )
            item["score"] += 1.0 / (RRF_K + rank)

        rrf_candidates = sorted(fused.values(), key=lambda x: x["score"], reverse=True)[:SEARCH_RRF_TOP_K]
        logger.info(LOG_PREFIX + "[timing.retrieve] rrf_fusion_ms=%.1f candidates=%s", (time.perf_counter() - stage_t0) * 1000, len(rrf_candidates))

        logger.info(LOG_PREFIX + "[hits.rrf] count=%s", len(rrf_candidates))
        rrf_stage_results = [dict(item) for item in rrf_candidates]
        for i, item in enumerate(rrf_candidates, start=1):
            _log_hit("rrf", i, item)

        stage_t0 = time.perf_counter()
        reranker = _get_reranker()
        logger.info(LOG_PREFIX + "[timing.retrieve] reranker_get_ms=%.1f enabled=%s", (time.perf_counter() - stage_t0) * 1000, int(reranker is not None))
        reranked = rrf_candidates
        if reranker is not None and rrf_candidates:
            pairs = [(query, item.get("text") or "") for item in rrf_candidates]
            stage_t0 = time.perf_counter()
            scores = reranker.predict(pairs, batch_size=8, convert_to_numpy=False)
            logger.info(LOG_PREFIX + "[timing.retrieve] reranker_predict_ms=%.1f pairs=%s", (time.perf_counter() - stage_t0) * 1000, len(pairs))
            scored = []
            for item, score in zip(rrf_candidates, scores):
                scored_item = dict(item)
                raw_score = float(score)
                scored_item["rerank_score_raw"] = raw_score
                scored_item["rerank_score"] = 1.0 / (1.0 + math.exp(-raw_score))
                scored.append(scored_item)
            reranked = sorted(scored, key=lambda x: x["rerank_score"], reverse=True)
            reranked = [item for item in reranked if item["rerank_score"] >= SEARCH_RERANK_THRESHOLD]

        logger.info(LOG_PREFIX + "[hits.rerank] count=%s", len(reranked))
        rerank_stage_results = [dict(item) for item in reranked]
        for i, item in enumerate(reranked, start=1):
            _log_hit("rerank", i, item)

        stage_t0 = time.perf_counter()
        merged = _merge_results(reranked[:SEARCH_RERANK_TOP_K])
        logger.info(LOG_PREFIX + "[timing.retrieve] merge_ms=%.1f merged=%s", (time.perf_counter() - stage_t0) * 1000, len(merged))

        llm_results = merged[:SEARCH_LLM_TOP_K]
        try:
            llm_results = _expand_to_parent_results(llm_results)
            logger.info(LOG_PREFIX + "[hits.llm] count=%s", len(llm_results))
            llm_stage_results = []
            for item in llm_results:
                llm_item = dict(item)
                llm_item["expansion"] = "parent-expanded"
                llm_stage_results.append(llm_item)
            for i, item in enumerate(llm_results, start=1):
                _log_hit("llm", i, item)
        except Exception:
            llm_stage_results = []
            pass
        return {
                    "results": llm_results,
                    "stage_results": {
                        "vector": vector_stage_results,
                        "bm25": bm25_stage_results,
                        "rrf": rrf_stage_results,
                        "rerank": rerank_stage_results,
                        "llm": llm_stage_results,
                    },
                }

    graph = StateGraph(SearchState)
    graph.add_node("retrieve", retrieve)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", END)
    return graph.compile()


def run_search(index: VectorStoreIndex, query: str) -> dict:
    t0 = time.perf_counter()
    graph = build_search_graph(index)
    logger.info(LOG_PREFIX + "[timing.run_search] build_graph_ms=%.1f", (time.perf_counter() - t0) * 1000)
    state = {"query": query}
    invoke_t0 = time.perf_counter()
    result = graph.invoke(state)
    logger.info(
        LOG_PREFIX + "[timing.run_search] invoke_ms=%.1f total_ms=%.1f",
        (time.perf_counter() - invoke_t0) * 1000,
        (time.perf_counter() - t0) * 1000,
    )
    return {
        "results": result.get("results", []),
    }


async def stream_answer(query: str, results: List[dict]) -> AsyncGenerator[dict, None]:
    stream_t0 = time.perf_counter()
    if not results:
        return
    if not is_llm_enabled():
        yield {
            "type": "delta",
            "content": "### 答案\nLLM 未启用，请检查 `DEEPSEEK_API_KEY` 是否正确加载，并重启后端。",
        }
        yield {"type": "usage", "usage": {}}
        return

    prompt_t0 = time.perf_counter()
    system, user = _build_prompt(query, results)
    logger.info(LOG_PREFIX + "[timing.llm] build_prompt_ms=%.1f results=%s prompt_chars=%s", (time.perf_counter() - prompt_t0) * 1000, len(results), len(system) + len(user))
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
    first_delta_logged = False
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            request_t0 = time.perf_counter()
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                logger.info(LOG_PREFIX + "[timing.llm] response_headers_ms=%.1f status=%s", (time.perf_counter() - request_t0) * 1000, resp.status_code)
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
                        if not first_delta_logged:
                            first_delta_logged = True
                            logger.info(LOG_PREFIX + "[timing.llm] first_delta_ms=%.1f", (time.perf_counter() - request_t0) * 1000)
                        yield {"type": "delta", "content": content}
    except Exception as exc:
        yield {"type": "delta", "content": f"### 答案\nLLM 调用失败：{exc}"}
        yield {"type": "usage", "usage": {}}
        return

    if usage:
        yield {"type": "usage", "usage": usage}
    logger.info(LOG_PREFIX + "[timing.llm] stream_total_ms=%.1f first_delta_seen=%s", (time.perf_counter() - stream_t0) * 1000, int(first_delta_logged))
