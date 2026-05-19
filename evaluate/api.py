from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel

from .service import run_evaluation


class EvaluateRequest(BaseModel):
    threshold: float = 0.85


def register_evaluate_routes(app) -> None:
    @app.post("/evaluate/run")
    async def evaluate_run(payload: EvaluateRequest) -> dict:
        try:
            return run_evaluation(threshold=payload.threshold)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="testset.json not found")
