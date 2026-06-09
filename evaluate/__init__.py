from __future__ import annotations

__all__ = ["run_evaluation"]


def __getattr__(name: str):
    if name == "run_evaluation":
        from .service import run_evaluation

        return run_evaluation
    raise AttributeError(name)
