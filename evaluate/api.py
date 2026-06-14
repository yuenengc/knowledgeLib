from __future__ import annotations

import os
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

from .service import run_evaluation


class EvaluateRequest(BaseModel):
    threshold: float = 0.85
    target: str | None = None
    evaluator: str | None = None
    top_k: int | None = None
    candidate_pool_top_k: int | None = None
    ranking_evaluation_top_k: int | None = None
    include_stage_metrics: bool = True
    options: dict[str, Any] | None = None


def register_evaluate_routes(app) -> None:
    @app.post("/evaluate/run")
    async def evaluate_run(payload: EvaluateRequest) -> dict:
        if os.getenv("EVALUATION_ENABLED", "true").lower() in {"0", "false", "no"}:
            raise HTTPException(status_code=404, detail="Evaluation is disabled")
        try:
            return run_evaluation(
                threshold=payload.threshold,
                target=payload.target,
                evaluator=payload.evaluator,
                top_k=payload.top_k,
                candidate_pool_top_k=payload.candidate_pool_top_k,
                ranking_evaluation_top_k=payload.ranking_evaluation_top_k,
                include_stage_metrics=payload.include_stage_metrics,
                options=payload.options,
            )
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="testset.json not found")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
