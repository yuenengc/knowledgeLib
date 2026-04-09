from __future__ import annotations

from typing import TypedDict, List, Dict, Tuple, AsyncGenerator
import logging
import os
import json

from langgraph.graph import StateGraph, END
from llama_index.core import VectorStoreIndex
from llama_index.core.base.base_retriever import BaseRetriever
from llama_index.core.retrievers import RecursiveRetriever
from rank_bm25 import BM25Okapi
import jieba
import httpx
from llama_index.core.schema import BaseNode, IndexNode, NodeWithScore, QueryBundle, TextNode

from .db import list_chunks
from .settings import is_llm_enabled, get_embed_query_prefix

logger = logging.getLogger("knowledge-lib.search")
LOG_PREFIX = "----logger   "


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

    def _snip(text: str, max_len: int = 200) -> str:
        value = (text or "").strip().replace("\n", " ")
        if len(value) > max_len:
            return value[:max_len] + "..."
        return value

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
        max_per_file: int = 3,
        max_chars: int = 5000,
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

        class _FixedRetriever(BaseRetriever):
            def __init__(self, nodes: List[NodeWithScore]):
                super().__init__()
                self._nodes = nodes

            def _retrieve(self, query_bundle: QueryBundle) -> List[NodeWithScore]:
                return self._nodes

        def _unwrap_vector_node(obj):
            # llama-index retrievers typically return NodeWithScore(node=BaseNode, score=float).
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

        def _content(base) -> str:
            if hasattr(base, "get_content"):
                try:
                    return base.get_content()
                except Exception:
                    return str(base)
            return getattr(base, "text", None) or str(base)

        logger.info(
            LOG_PREFIX + "[retrieve] query=%s vector_query=%s top_k=%s",
            query,
            vector_query,
            top_k,
        )

        retriever = index.as_retriever(similarity_top_k=max(top_k * 2, 5))
        vector_nodes_raw = retriever.retrieve(vector_query)

        # Expand IndexNode -> parent section TextNode (full section text) via RecursiveRetriever.
        # IndexNodes produced by the indexer embed the parent node in `obj` (serialized in the
        # vector store payload), enabling parent recovery without a separate docstore.
        node_dict: Dict[str, BaseNode] = {}
        for nws in vector_nodes_raw:
            node = getattr(nws, "node", None) or nws
            if isinstance(node, IndexNode) and isinstance(node.obj, BaseNode):
                node_dict[node.index_id] = node.obj

        if node_dict:
            # Ensure every IndexNode has a resolvable target to avoid RecursiveRetriever errors.
            for nws in vector_nodes_raw:
                node = getattr(nws, "node", None) or nws
                if isinstance(node, IndexNode) and node.index_id not in node_dict:
                    node_dict[node.index_id] = TextNode(
                        id_=node.index_id,
                        text=node.get_content(),
                        metadata=dict(getattr(node, "metadata", {}) or {}),
                    )
            vector_nodes: List[NodeWithScore] = RecursiveRetriever(
                root_id="root",
                retriever_dict={"root": _FixedRetriever(vector_nodes_raw)},
                node_dict=node_dict,
            ).retrieve(vector_query)
        else:
            vector_nodes = vector_nodes_raw

        bm25, bm25_nodes, _ = _get_bm25()
        bm25_ranked = []
        if bm25 is not None:
            scores = bm25.get_scores(_tokenize(query))
            bm25_ranked = sorted(
                enumerate(scores), key=lambda x: x[1], reverse=True
            )[: max(top_k * 2, 5)]

        # Log raw hits: vector vs keyword (BM25)
        logger.info(LOG_PREFIX + "[hits.vector] count=%s", len(vector_nodes))
        for i, obj in enumerate(vector_nodes[: max(top_k * 2, 5)], start=1):
            base, score = _unwrap_vector_node(obj)
            meta = _metadata(base)
            chunk_id = _node_id(base)
            logger.info(
                LOG_PREFIX + "[hits.vector] #%s score=%s file=%s chunk_id=%s text=%s",
                i,
                score,
                meta.get("file_name"),
                chunk_id,
                _snip(_content(base)),
            )

        logger.info(LOG_PREFIX + "[hits.bm25] count=%s", len(bm25_ranked))
        for i, (idx, score) in enumerate(bm25_ranked[: max(top_k * 2, 5)], start=1):
            item = bm25_nodes[idx]
            logger.info(
                LOG_PREFIX + "[hits.bm25] #%s score=%s file=%s chunk_id=%s text=%s",
                i,
                float(score),
                item.get("file_name"),
                item.get("id"),
                _snip(item.get("text") or ""),
            )

        fused: Dict[str, dict] = {}
        rrf_k = 60.0

        for rank, obj in enumerate(vector_nodes, start=1):
            base, _score = _unwrap_vector_node(obj)
            node_id = _node_id(base)
            metadata = _metadata(base)
            item = fused.setdefault(
                node_id,
                {
                    "score": 0.0,
                    "text": _content(base),
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
            node_id = n.get("parent_id") or n["id"]
            text_for_llm = n.get("parent_text") or n.get("text") or ""
            item = fused.setdefault(
                node_id,
                {
                    "score": 0.0,
                    "text": text_for_llm,
                    "file_name": n["file_name"],
                    "file_id": n["file_id"],
                    "source_path": n["stored_path"],
                    "order_idx": n.get("order_idx"),
                    "chunk_id": node_id,
                },
            )
            item["score"] += 1.0 / (rrf_k + rank)

        results = sorted(fused.values(), key=lambda x: x["score"], reverse=True)[: max(top_k * 2, 6)]
        merged = _merge_results(results)

        try:
            logger.info(LOG_PREFIX + "[hits.final] count=%s", len(merged[:top_k]))
            for i, item in enumerate(merged[:top_k], start=1):
                logger.info(
                    LOG_PREFIX + "[hits.final] #%s score=%s file=%s chunk_id=%s text=%s",
                    i,
                    item.get("score"),
                    item.get("file_name"),
                    item.get("chunk_id"),
                    _snip(item.get("text") or ""),
                )
        except Exception:
            pass

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
