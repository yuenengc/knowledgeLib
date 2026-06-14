from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from backend.settings import configure_llm

from .evaluators import FuzzyFragmentEvaluator
from .interfaces import EvaluationOptions, EvaluationTarget, Evaluator
from .targets import DefaultRagEvaluationTarget


EVALUATE_DIR = Path(__file__).resolve().parent
TESTSET_PATH = EVALUATE_DIR / "testset.json"

DEFAULT_TARGET = "default_rag"
DEFAULT_EVALUATOR = "fuzzy_fragment"
ALLOWED_CANDIDATE_POOL_TOP_K = {10, 20, 50, 100}
ALLOWED_RANKING_EVALUATION_TOP_K = {3, 5, 7}


def _load_testset() -> dict:
    if not TESTSET_PATH.exists():
        return {"queries": []}
    with TESTSET_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _target_factories() -> dict[str, type[EvaluationTarget]]:
    return {
        DefaultRagEvaluationTarget.name: DefaultRagEvaluationTarget,
    }


def _evaluator_factories() -> dict[str, type[Evaluator]]:
    return {
        FuzzyFragmentEvaluator.name: FuzzyFragmentEvaluator,
    }


def _resolve_target(name: str | None) -> EvaluationTarget:
    target_name = name or os.getenv("EVALUATION_TARGET") or DEFAULT_TARGET
    factories = _target_factories()
    if target_name not in factories:
        available = ", ".join(sorted(factories))
        raise ValueError(f"Unknown evaluation target '{target_name}'. Available targets: {available}")
    return factories[target_name]()


def _resolve_evaluator(name: str | None) -> Evaluator:
    evaluator_name = name or os.getenv("EVALUATION_EVALUATOR") or DEFAULT_EVALUATOR
    factories = _evaluator_factories()
    if evaluator_name not in factories:
        available = ", ".join(sorted(factories))
        raise ValueError(f"Unknown evaluator '{evaluator_name}'. Available evaluators: {available}")
    return factories[evaluator_name]()


def run_evaluation(
    threshold: float = 0.85,
    target: str | None = None,
    evaluator: str | None = None,
    top_k: int | None = None,
    candidate_pool_top_k: int | None = None,
    ranking_evaluation_top_k: int | None = None,
    include_stage_metrics: bool = True,
    options: dict[str, Any] | None = None,
) -> dict:
    if (
        candidate_pool_top_k is not None
        and candidate_pool_top_k not in ALLOWED_CANDIDATE_POOL_TOP_K
    ):
        allowed = ", ".join(str(value) for value in sorted(ALLOWED_CANDIDATE_POOL_TOP_K))
        raise ValueError(f"candidate_pool_top_k must be one of: {allowed}")
    if (
        ranking_evaluation_top_k is not None
        and ranking_evaluation_top_k not in ALLOWED_RANKING_EVALUATION_TOP_K
    ):
        allowed = ", ".join(str(value) for value in sorted(ALLOWED_RANKING_EVALUATION_TOP_K))
        raise ValueError(f"ranking_evaluation_top_k must be one of: {allowed}")

    configure_llm()
    testset = _load_testset()
    target_plugin = _resolve_target(target)
    evaluator_plugin = _resolve_evaluator(evaluator)
    eval_options = EvaluationOptions(
        threshold=threshold,
        top_k=top_k,
        candidate_pool_top_k=candidate_pool_top_k,
        ranking_evaluation_top_k=ranking_evaluation_top_k,
        include_stage_metrics=include_stage_metrics,
        extra=options or {},
    )
    report = evaluator_plugin.evaluate(testset, target_plugin, eval_options)
    report.setdefault("summary", {})
    report["summary"].setdefault("target", target_plugin.name)
    report["summary"].setdefault("evaluator", evaluator_plugin.name)
    return report
