from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


SearchHit = dict[str, Any]


@dataclass
class EvaluationOptions:
    threshold: float = 0.85
    top_k: int | None = None
    include_stage_metrics: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class EvaluationRunOutput:
    results: list[SearchHit]
    stage_results: dict[str, list[SearchHit]] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class EvaluationTarget(Protocol):
    name: str

    def run_query(self, query: str, top_k: int) -> EvaluationRunOutput:
        ...


class Evaluator(Protocol):
    name: str

    def evaluate(self, testset: dict, target: EvaluationTarget, options: EvaluationOptions) -> dict:
        ...
