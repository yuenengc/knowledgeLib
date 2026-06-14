from __future__ import annotations

from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any

from rapidfuzz import fuzz

from backend.settings import (
    SEARCH_BM25_TOP_K,
    SEARCH_VECTOR_TOP_K,
    SEARCH_RRF_TOP_K,
    SEARCH_RERANK_TOP_K,
    SEARCH_LLM_TOP_K,
)

from .interfaces import EvaluationOptions, EvaluationTarget


STAGE_TOP_K = {
    "vector": SEARCH_VECTOR_TOP_K,
    "bm25": SEARCH_BM25_TOP_K,
    "rrf": SEARCH_RRF_TOP_K,
    "rerank": SEARCH_RERANK_TOP_K,
    "llm": SEARCH_LLM_TOP_K,
}


def _stage_top_k(options: EvaluationOptions) -> dict[str, int]:
    values = dict(STAGE_TOP_K)
    if options.candidate_pool_top_k is not None:
        values["vector"] = options.candidate_pool_top_k
        values["bm25"] = options.candidate_pool_top_k
        values["rrf"] = options.candidate_pool_top_k
    if options.ranking_evaluation_top_k is not None:
        values["rerank"] = options.ranking_evaluation_top_k
    return values


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
            # partial_ratio reflects whether the golden fragment appears inside a passage.
            ratio = fuzz.partial_ratio(normalized_fragment, normalized_candidate) / 100.0
        if ratio > best_ratio:
            best_ratio = ratio
            best_candidate = candidate
    return best_ratio >= threshold, best_ratio, best_candidate


class FuzzyFragmentEvaluator:
    name = "fuzzy_fragment"

    def evaluate(self, testset: dict, target: EvaluationTarget, options: EvaluationOptions) -> dict:
        queries = testset.get("queries") or []
        started = perf_counter()
        details = [self._evaluate_query(item, target, options) for item in queries]
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
                "threshold": options.threshold,
                "elapsed_seconds": elapsed,
                "stage_top_k": _stage_top_k(options),
            },
            "details": [asdict(d) for d in details],
        }

    def _evaluate_query(
        self,
        item: dict,
        target: EvaluationTarget,
        options: EvaluationOptions,
    ) -> QueryEvalResult:
        top_k = options.top_k or SEARCH_LLM_TOP_K
        output = target.run_query(
            item["query"],
            top_k=top_k,
            candidate_pool_top_k=options.candidate_pool_top_k,
            ranking_evaluation_top_k=options.ranking_evaluation_top_k,
        )
        results = output.results

        final_k = min(len(results), top_k)
        ranked_texts = [r.get("text") or "" for r in results[:final_k]]
        matched_golden = []
        missed_golden = []
        first_match_rank = None
        matched_count = 0

        for fragment in item.get("golden_fragments", []):
            matched, _best_ratio, _best_candidate = _best_match(
                fragment,
                ranked_texts,
                options.threshold,
            )
            if matched:
                matched_count += 1
                matched_golden.append(fragment)
                if first_match_rank is None:
                    first_match_rank = self._first_match_rank(fragment, ranked_texts, options.threshold)
            else:
                missed_golden.append(fragment)

        retrieved_count = final_k
        relevant_count = len(item.get("golden_fragments", []))
        precision_at_k = matched_count / retrieved_count if retrieved_count else 0.0
        recall_at_k = matched_count / relevant_count if relevant_count else 0.0
        mrr = 1.0 / first_match_rank if first_match_rank else 0.0

        stages_payload: dict[str, list[dict[str, Any]]] = {}
        stage_metrics: dict[str, dict[str, float]] = {}
        if options.include_stage_metrics:
            stages_payload, stage_metrics = self._evaluate_stages(
                output.stage_results,
                list(item.get("golden_fragments", [])),
                relevant_count,
                options.threshold,
                _stage_top_k(options),
            )

        return QueryEvalResult(
            id=item["id"],
            query=item["query"],
            golden_fragments=list(item.get("golden_fragments", [])),
            top_k=final_k,
            threshold=options.threshold,
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

    def _first_match_rank(self, fragment: str, candidates: list[str], threshold: float) -> int | None:
        normalized_fragment = _normalize_text(fragment)
        for idx, candidate in enumerate(candidates, start=1):
            normalized_candidate = _normalize_text(candidate)
            if normalized_fragment and normalized_fragment in normalized_candidate:
                ratio = 1.0
            else:
                ratio = fuzz.partial_ratio(normalized_fragment, normalized_candidate) / 100.0
            if ratio >= threshold:
                return idx
        return None

    def _evaluate_stages(
        self,
        stage_results: dict[str, list[dict]],
        golden_fragments: list[str],
        relevant_count: int,
        threshold: float,
        stage_top_k: dict[str, int],
    ) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, float]]]:
        stages_payload = {}
        stage_metrics: dict[str, dict[str, float]] = {}
        for stage, items in stage_results.items():
            stages_payload[stage] = []
            stage_k = stage_top_k.get(stage, len(items))
            stage_retrieved = min(len(items), stage_k)
            stage_matched_count = 0
            stage_first_match_rank = None

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

        return stages_payload, stage_metrics
