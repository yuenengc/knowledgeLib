from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any

from rapidfuzz import fuzz

from backend.graph import build_search_graph
from backend.indexer import get_index
from backend.settings import (
    configure_llm,
    SEARCH_BM25_TOP_K,
    SEARCH_VECTOR_TOP_K,
    SEARCH_RRF_TOP_K,
    SEARCH_RERANK_TOP_K,
    SEARCH_LLM_TOP_K,
)


EVALUATE_DIR = Path(__file__).resolve().parent
TESTSET_PATH = EVALUATE_DIR / "testset.json"


@dataclass
class StageMatch:
    rank: int
    matched: bool
    best_ratio: float
    best_fragment: str | None
    matched_fragment: str | None


@dataclass
class QueryEvalResult:
    id: str
    query: str
    golden_fragments: list[str]
    top_k: int
    threshold: float
    relevant_count: int
    retrieved_count: int
    matched_count: int
    precision_at_k: float
    recall_at_k: float
    mrr: float
    stages: dict[str, list[dict[str, Any]]]
    stage_metrics: dict[str, dict[str, float]]
    ranked_hits: list[dict[str, Any]]
    matched_golden_fragments: list[str]
    missed_golden_fragments: list[str]


def _load_testset() -> dict:
    if not TESTSET_PATH.exists():
        return {"queries": []}
    with TESTSET_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _normalize_text(text: str) -> str:
    return " ".join((text or "").split())


def _best_match(fragment: str, candidates: list[str], threshold: float) -> tuple[bool, float, str | None]:
    best_ratio = 0.0
    best_candidate = None
    normalized_fragment = _normalize_text(fragment)
    for candidate in candidates:
        normalized_candidate = _normalize_text(candidate)
        if not normalized_fragment or not normalized_candidate:
            ratio = 0.0
        elif normalized_fragment in normalized_candidate:
            ratio = 1.0
        else:
            # Full ratio punishes short fragments embedded in long passages.
            # partial_ratio better reflects "does this fragment appear in the text?".
            ratio = fuzz.partial_ratio(normalized_fragment, normalized_candidate) / 100.0
        if ratio > best_ratio:
            best_ratio = ratio
            best_candidate = candidate
    return best_ratio >= threshold, best_ratio, best_candidate


def _extract_stage_texts(results: list[dict], stage_name: str) -> list[dict]:
    stage_key = stage_name.lower()
    if stage_key == "vector":
        return results
    return results


def _collect_stage_results(payload: dict) -> dict[str, list[dict]]:
    stage_results = payload.get("stage_results") or {}
    normalized = {}
    for stage, items in stage_results.items():
        normalized[stage] = list(items or [])
    return normalized


STAGE_TOP_K = {
    "vector": SEARCH_VECTOR_TOP_K,
    "bm25": SEARCH_BM25_TOP_K,
    "rrf": SEARCH_RRF_TOP_K,
    "rerank": SEARCH_RERANK_TOP_K,
    "llm": SEARCH_LLM_TOP_K,
}


def _evaluate_query(item: dict, threshold: float) -> QueryEvalResult:
    index = get_index()
    graph = build_search_graph(index)
    state = {"query": item["query"], "top_k": SEARCH_LLM_TOP_K}
    result = graph.invoke(state)

    results = list((result or {}).get("results", []))
    stage_results = _collect_stage_results(result or {})

    final_k = min(len(results), SEARCH_LLM_TOP_K)
    ranked_texts = [r.get("text") or "" for r in results[:final_k]]
    matched_golden = []
    missed_golden = []
    first_match_rank = None
    matched_count = 0

    for fragment in item.get("golden_fragments", []):
        matched, best_ratio, best_candidate = _best_match(fragment, ranked_texts, threshold)
        if matched:
            matched_count += 1
            matched_golden.append(fragment)
            if first_match_rank is None:
                for idx, candidate in enumerate(ranked_texts, start=1):
                    normalized_fragment = _normalize_text(fragment)
                    normalized_candidate = _normalize_text(candidate)
                    if normalized_fragment and normalized_fragment in normalized_candidate:
                        ratio = 1.0
                    else:
                        ratio = fuzz.partial_ratio(normalized_fragment, normalized_candidate) / 100.0
                    if ratio >= threshold:
                        first_match_rank = idx
                        break
        else:
            missed_golden.append(fragment)

    retrieved_count = final_k
    relevant_count = len(item.get("golden_fragments", []))
    precision_at_k = matched_count / retrieved_count if retrieved_count else 0.0
    recall_at_k = matched_count / relevant_count if relevant_count else 0.0
    mrr = 1.0 / first_match_rank if first_match_rank else 0.0

    stages_payload = {}
    stage_metrics: dict[str, dict[str, float]] = {}
    for stage, items in stage_results.items():
        stages_payload[stage] = []
        stage_k = STAGE_TOP_K.get(stage, len(items))
        stage_retrieved = min(len(items), stage_k)
        stage_matched_count = 0
        stage_first_match_rank = None
        golden_fragments = list(item.get("golden_fragments", []))
        for rank, stage_item in enumerate(items[:stage_k], start=1):
            text = stage_item.get("text") or ""
            hit_matched = False
            hit_best_ratio = 0.0
            hit_best_fragment = None
            stage_matches = []
            for fragment in golden_fragments:
                matched, best_ratio, best_candidate = _best_match(fragment, [text], threshold)
                stage_matches.append(
                    {
                        "golden_fragment": fragment,
                        "matched": matched,
                        "best_ratio": best_ratio,
                        "best_candidate": best_candidate,
                    }
                )
                if matched and best_ratio > hit_best_ratio:
                    hit_matched = True
                    hit_best_ratio = best_ratio
                    hit_best_fragment = fragment
            if hit_matched:
                stage_matched_count += 1
                if stage_first_match_rank is None:
                    stage_first_match_rank = rank
            stages_payload[stage].append(
                {
                    "rank": rank,
                    "score": stage_item.get("score"),
                    "rerank_score": stage_item.get("rerank_score"),
                    "file_name": stage_item.get("file_name"),
                    "chunk_id": stage_item.get("chunk_id"),
                    "text": text,
                    "matched": hit_matched,
                    "best_match_ratio": hit_best_ratio,
                    "best_match_fragment": hit_best_fragment,
                    "matches": stage_matches,
                }
            )
        stage_metrics[stage] = {
            "k": stage_retrieved,
            "precision_at_k": stage_matched_count / stage_retrieved if stage_retrieved else 0.0,
            "recall_at_k": stage_matched_count / relevant_count if relevant_count else 0.0,
            "mrr": 1.0 / stage_first_match_rank if stage_first_match_rank else 0.0,
        }

    return QueryEvalResult(
        id=item["id"],
        query=item["query"],
        golden_fragments=list(item.get("golden_fragments", [])),
        top_k=final_k,
        threshold=threshold,
        relevant_count=relevant_count,
        retrieved_count=retrieved_count,
        matched_count=matched_count,
        precision_at_k=precision_at_k,
        recall_at_k=recall_at_k,
        mrr=mrr,
        stages=stages_payload,
        stage_metrics=stage_metrics,
        ranked_hits=results[:final_k],
        matched_golden_fragments=matched_golden,
        missed_golden_fragments=missed_golden,
    )


def run_evaluation(threshold: float = 0.85) -> dict:
    configure_llm()
    payload = _load_testset()
    queries = payload.get("queries") or []
    started = perf_counter()
    details = [_evaluate_query(item, threshold=threshold) for item in queries]
    elapsed = perf_counter() - started

    count = len(details)
    precision = sum(d.precision_at_k for d in details) / count if count else 0.0
    recall = sum(d.recall_at_k for d in details) / count if count else 0.0
    mrr = sum(d.mrr for d in details) / count if count else 0.0

    return {
        "summary": {
            "query_count": count,
            "precision_at_k": precision,
            "recall_at_k": recall,
            "mrr": mrr,
            "threshold": threshold,
            "elapsed_seconds": elapsed,
            "stage_top_k": STAGE_TOP_K,
        },
        "details": [asdict(d) for d in details],
    }
