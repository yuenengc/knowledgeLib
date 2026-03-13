from __future__ import annotations

from typing import TypedDict, List, Any

from langgraph.graph import StateGraph, END
from llama_index.core import VectorStoreIndex


class SearchState(TypedDict):
    query: str
    top_k: int
    nodes: List[Any]
    results: List[dict]


def build_search_graph(index: VectorStoreIndex):
    def retrieve(state: SearchState) -> dict:
        retriever = index.as_retriever(similarity_top_k=state["top_k"])
        nodes = retriever.retrieve(state["query"])
        return {"nodes": nodes}

    def format_results(state: SearchState) -> dict:
        results = []
        for node in state["nodes"]:
            metadata = getattr(node, "metadata", {}) or {}
            results.append(
                {
                    "score": getattr(node, "score", None),
                    "text": node.get_content() if hasattr(node, "get_content") else str(node),
                    "file_name": metadata.get("file_name"),
                    "file_id": metadata.get("file_id"),
                    "source_path": metadata.get("stored_path"),
                }
            )
        return {"results": results}

    graph = StateGraph(SearchState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("format", format_results)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "format")
    graph.add_edge("format", END)
    return graph.compile()


def run_search(index: VectorStoreIndex, query: str, top_k: int) -> list[dict]:
    graph = build_search_graph(index)
    state = {"query": query, "top_k": top_k}
    result = graph.invoke(state)
    return result.get("results", [])
