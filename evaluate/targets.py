from __future__ import annotations

from backend.graph import build_search_graph
from backend.indexer import get_index
from backend.settings import SEARCH_LLM_TOP_K

from .interfaces import EvaluationRunOutput


class DefaultRagEvaluationTarget:
    name = "default_rag"

    def __init__(self) -> None:
        self._graph = None

    def _get_graph(self):
        if self._graph is None:
            index = get_index()
            self._graph = build_search_graph(index)
        return self._graph

    def run_query(
        self,
        query: str,
        top_k: int,
        candidate_pool_top_k: int | None = None,
        ranking_evaluation_top_k: int | None = None,
    ) -> EvaluationRunOutput:
        state = {
            "query": query,
            "top_k": top_k or SEARCH_LLM_TOP_K,
            "candidate_pool_top_k": candidate_pool_top_k,
            "ranking_evaluation_top_k": ranking_evaluation_top_k,
        }
        result = self._get_graph().invoke(state) or {}
        return EvaluationRunOutput(
            results=list(result.get("results") or []),
            stage_results={
                stage: list(items or [])
                for stage, items in (result.get("stage_results") or {}).items()
            },
        )
