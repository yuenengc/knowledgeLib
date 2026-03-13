from __future__ import annotations

from typing import TypedDict, List, Any, Dict, Tuple

from langgraph.graph import StateGraph, END
from llama_index.core import VectorStoreIndex
from llama_index.core import Settings
from llama_index.core.llms import ChatMessage
from llama_index.core.base.llms.types import MessageRole
from rank_bm25 import BM25Okapi
import jieba

from .db import list_nodes


class SearchState(TypedDict):
    query: str
    top_k: int
    results: List[dict]
    answer: str


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
                },
            )
            item["score"] += 1.0 / (rrf_k + rank)

        results = sorted(fused.values(), key=lambda x: x["score"], reverse=True)[:top_k]
        return {"results": results}

    def generate_answer(state: SearchState) -> dict:
        results = state["results"]
        if not results:
            return {"answer": ""}

        sources = []
        for idx, item in enumerate(results, start=1):
            snippet = item["text"].strip().replace("\n", " ")
            if len(snippet) > 800:
                snippet = snippet[:800] + "..."
            sources.append(f"[{idx}] {item.get('file_name')}\n{snippet}")

        system = (
            "你是企业知识库助手。仅使用提供的资料回答问题。"
            "如无法从资料得出答案，请明确说明。回答必须标注引用来源，如[1][2]。"
        )
        user = "问题：{query}\n\n资料：\n{sources}\n\n请给出答案并标注引用。".format(
            query=state["query"],
            sources="\n\n".join(sources),
        )

        llm = Settings.llm
        try:
            resp = llm.chat(
                [
                    ChatMessage(role=MessageRole.SYSTEM, content=system),
                    ChatMessage(role=MessageRole.USER, content=user),
                ]
            )
            content = getattr(resp, "message", None)
            answer_text = content.content if content is not None else str(resp)
        except Exception:
            answer_text = ""

        return {"answer": answer_text}

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
    }
