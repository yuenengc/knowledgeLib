"use client";

import { useEffect, useMemo, useState } from "react";

type StageHit = {
  rank: number;
  score?: number;
  rerank_score?: number;
  file_name?: string;
  chunk_id?: string;
  text: string;
  expansion?: string;
  matched?: boolean;
  best_match_ratio?: number;
  best_match_fragment?: string | null;
  matches: Array<{
    golden_fragment: string;
    matched: boolean;
    best_ratio: number;
    best_candidate: string | null;
  }>;
};

type QueryDetail = {
  id: string;
  query: string;
  golden_fragments: string[];
  threshold: number;
  relevant_count: number;
  retrieved_count: number;
  matched_count: number;
  precision_at_k: number;
  recall_at_k: number;
  mrr: number;
  stages: Record<string, StageHit[]>;
  stage_metrics: Record<
    string,
    {
      k: number;
      precision_at_k: number;
      recall_at_k: number;
      mrr: number;
    }
  >;
  ranked_hits: Array<Record<string, unknown>>;
  matched_golden_fragments: string[];
  missed_golden_fragments: string[];
};

type EvalPayload = {
  summary: {
    query_count: number;
    precision_at_k: number;
    recall_at_k: number;
    mrr: number;
    threshold: number;
    elapsed_seconds: number;
    stage_top_k: Record<string, number>;
  };
  details: QueryDetail[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function EvaluatePage() {
  const [running, setRunning] = useState(false);
  const [payload, setPayload] = useState<EvalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStages, setActiveStages] = useState<Record<string, string>>({});
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);

  const stageOrder = useMemo(() => ["vector", "bm25", "rrf", "rerank", "llm"], []);

  useEffect(() => {
    if (!payload) return;
    setActiveStages((current) => {
      const next = { ...current };
      for (const item of payload.details) {
        const stages = Object.keys(item.stages);
        if (!stages.length) continue;
        if (!next[item.id] || !stages.includes(next[item.id])) {
          next[item.id] = stages.find((stage) => stageOrder.includes(stage)) ?? stages[0];
        }
      }
      return next;
    });
    setSelectedQueryId((current) => current || payload.details[0]?.id || null);
  }, [payload, stageOrder]);

  const runEvaluation = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/evaluate/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: 0.85 }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as EvalPayload;
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setRunning(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const stageLabel = (stage: string, hit?: StageHit) => {
    if (stage === "llm" && hit?.expansion === "parent-expanded") {
      return "LLM (parent-expanded)";
    }
    return stage.toUpperCase();
  };

  const metricTooltip = (
    metric: "precision" | "recall" | "mrr",
    values: {
      precision?: number;
      recall?: number;
      mrr?: number;
      relevant?: number;
      retrieved?: number;
      firstRank?: number | null;
      k?: number;
    }
  ) => {
    if (metric === "precision") {
      const k = values.k ?? 0;
      const retrieved = values.retrieved ?? 0;
      const precision = values.precision ?? 0;
      return [
        `Precision@K = 前 K 个结果中相关文档的数量 / K`,
        `= ${retrieved} / ${k} = ${precision.toFixed(4)}`,
        `取值范围: [0, 1]`,
      ].join("\n");
    }
    if (metric === "recall") {
      const relevant = values.relevant ?? 0;
      const retrieved = values.retrieved ?? 0;
      const recall = values.recall ?? 0;
      return [
        `Recall@K = 前 K 个结果中相关文档的数量 / 整个数据集中相关文档的总数`,
        `= ${retrieved} / ${relevant} = ${recall.toFixed(4)}`,
        `取值范围: [0, 1]`,
      ].join("\n");
    }
    const firstRank = values.firstRank ?? null;
    const mrr = values.mrr ?? 0;
    return [
      `MRR = 1 / 第一个相关结果的排名`,
      firstRank ? `= 1 / ${firstRank} = ${mrr.toFixed(4)}` : `= 0`,
      `取值范围: [0, 1]`,
    ].join("\n");
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Evaluate</p>
              <h1 className="mt-3 text-3xl font-semibold">Search quality evaluation</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Reads `evaluate/testset.json`, calls the main retrieval pipeline, and shows Precision@K,
                Recall@K, MRR, plus per-query stage-level hit details.
              </p>
            </div>
            <button
              onClick={runEvaluation}
              disabled={running}
              className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? "Running..." : "Start evaluation"}
            </button>
          </div>
          {error && (
            <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {error}
            </div>
          )}
        </section>

        {payload && (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              {[
                ["Query count", payload.summary.query_count],
                ["Precision@K", payload.summary.precision_at_k.toFixed(4)],
                ["Recall@K", payload.summary.recall_at_k.toFixed(4)],
                ["MRR", payload.summary.mrr.toFixed(4)],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</div>
                  <div className="mt-3 text-2xl font-semibold">
                    <span
                      className="cursor-help"
                      title={
                        label === "Precision@K"
                          ? [
                            `Precision@K = (1/N) * Σ_i Precision_i`,
                            `= ${payload.summary.precision_at_k.toFixed(4)}`,
                            `取值范围: [0, 1]`,
                          ].join("\n")
                          : label === "Recall@K"
                            ? [
                              `Recall@K = (1/N) * Σ_i Recall_i`,
                              `= ${payload.summary.recall_at_k.toFixed(4)}`,
                              `取值范围: [0, 1]`,
                            ].join("\n")
                            : [
                              `MRR = (1/N) * Σ_i (1 / rank_i)`,
                              `= ${payload.summary.mrr.toFixed(4)}`,
                              `取值范围: [0, 1]`,
                            ].join("\n")
                      }
                    >
                      {value as string}
                    </span>
                  </div>
                </div>
              ))}
            </section>

            <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/20">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <div className="text-sm font-semibold text-white">Query list</div>
                    <div className="mt-1 text-xs text-slate-400">{payload.details.length} items</div>
                  </div>
                  <div className="text-xs text-slate-500">Backend-driven stage K</div>
                </div>
                <div className="mt-4 max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto pr-1">
                  {payload.details.map((item) => {
                    const selected = item.id === selectedQueryId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedQueryId(item.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${selected
                          ? "border-cyan-400/50 bg-cyan-400/10"
                          : "border-white/10 bg-slate-950/30 hover:border-white/20 hover:bg-white/5"
                          }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.25em] text-cyan-300">{item.id}</div>
                            <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-100">{item.query}</div>
                          </div>
                          <div className="text-right text-[11px] text-slate-400">
                            {/* <div>P@K {item.precision_at_k.toFixed(3)}</div>
                            <div>R@K {item.recall_at_k.toFixed(3)}</div> */}
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2 text-[11px] text-slate-400">
                          <span className="rounded-full bg-white/5 px-2 py-1">M {item.matched_count}</span>
                          <span className="rounded-full bg-white/5 px-2 py-1">R {item.relevant_count}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="min-w-0">
                {(() => {
                  const item = payload.details.find((entry) => entry.id === selectedQueryId) || payload.details[0];
                  if (!item) return null;
                  return (
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
                      <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-sm text-cyan-300">{item.id}</div>
                          <div className="mt-1 text-2xl font-semibold">{item.query}</div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
                            <span className="rounded-full bg-emerald-500/15 px-3 py-1">Matched: {item.matched_count}</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Relevant: {item.relevant_count}</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Retrieved: {item.retrieved_count}</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Threshold: {item.threshold}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-center">
                            <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-200">Precision@K</div>
                            <div
                              className="mt-1 text-lg font-semibold text-cyan-300"
                              title={metricTooltip("precision", {
                                precision: item.precision_at_k,
                                retrieved: item.matched_count,
                                k: item.retrieved_count,
                              })}
                            >
                              {item.precision_at_k.toFixed(4)}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-center">
                            <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-200">Recall@K</div>
                            <div
                              className="mt-1 text-lg font-semibold text-cyan-300"
                              title={metricTooltip("recall", {
                                recall: item.recall_at_k,
                                relevant: item.relevant_count,
                                retrieved: item.matched_count,
                              })}
                            >
                              {item.recall_at_k.toFixed(4)}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-center">
                            <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-200">MRR</div>
                            <div
                              className="mt-1 text-lg font-semibold text-cyan-300"
                              title={metricTooltip("mrr", {
                                mrr: item.mrr,
                                firstRank: item.mrr > 0 ? Math.round(1 / item.mrr) : null,
                              })}
                            >
                              {item.mrr.toFixed(4)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-5">
                        <div className="rounded-2xl bg-slate-950/60 p-4">
                          <div className="text-sm font-semibold text-slate-200">Coverage</div>
                          <div className="mt-3 grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Matched fragments</div>
                              <ul className="mt-2 space-y-2 text-sm text-slate-200">
                                {item.matched_golden_fragments.map((fragment) => (
                                  <li key={fragment} className="rounded-xl bg-emerald-500/10 px-3 py-2">
                                    {fragment}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Missed fragments</div>
                              <ul className="mt-2 space-y-2 text-sm text-slate-200">
                                {item.missed_golden_fragments.map((fragment) => (
                                  <li key={fragment} className="rounded-xl bg-rose-500/10 px-3 py-2">
                                    {fragment}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                          <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
                            {Object.keys(item.stages)
                              .sort((a, b) => stageOrder.indexOf(a) - stageOrder.indexOf(b))
                              .map((stage) => {
                                const active = activeStages[item.id] === stage;
                                return (
                                  <button
                                    key={stage}
                                    type="button"
                                    onClick={() =>
                                      setActiveStages((current) => ({
                                        ...current,
                                        [item.id]: stage,
                                      }))
                                    }
                                    className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${active
                                      ? "bg-cyan-400 text-slate-950"
                                      : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                                      }`}
                                  >
                                    {stageLabel(stage, item.stages[stage]?.[0])}
                                  </button>
                                );
                              })}
                          </div>

                          {(() => {
                            const stage = activeStages[item.id] || Object.keys(item.stages)[0];
                            const hits = item.stages[stage] || [];
                            const metrics = item.stage_metrics?.[stage];
                            return (
                              <div className="mt-4">
                                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                                  <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                                      {stageLabel(stage, hits[0])}
                                    </div>
                                    <div className="text-xs text-slate-400">{hits.length} hits</div>
                                  </div>
                                  {metrics && (
                                    <div className="flex flex-wrap gap-2 text-xs text-slate-300 md:justify-end">
                                      <span
                                        className="rounded-full bg-white/5 px-3 py-1"
                                        title={metricTooltip("precision", {
                                          precision: metrics.precision_at_k,
                                          retrieved: metrics.k ? Math.round(metrics.precision_at_k * metrics.k) : 0,
                                          k: metrics.k,
                                        })}
                                      >
                                        P@{metrics.k} = {metrics.precision_at_k.toFixed(4)}
                                      </span>
                                      <span
                                        className="rounded-full bg-white/5 px-3 py-1"
                                        title={metricTooltip("recall", {
                                          recall: metrics.recall_at_k,
                                          relevant: item.relevant_count,
                                          retrieved: metrics.k ? Math.round(metrics.recall_at_k * item.relevant_count) : 0,
                                        })}
                                      >
                                        R@{metrics.k} = {metrics.recall_at_k.toFixed(4)}
                                      </span>
                                      <span
                                        className="rounded-full bg-white/5 px-3 py-1"
                                        title={metricTooltip("mrr", {
                                          mrr: metrics.mrr,
                                          firstRank: metrics.mrr > 0 ? Math.round(1 / metrics.mrr) : null,
                                        })}
                                      >
                                        MRR = {metrics.mrr.toFixed(4)}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="mt-4 space-y-3">
                                  {hits.map((hit) => (
                                    <div key={`${stage}-${hit.rank}`} className="rounded-2xl bg-white/5 p-4">
                                      <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                                        <span>Rank {hit.rank}</span>
                                        {hit.score !== undefined && <span>Score {String(hit.score)}</span>}
                                        {hit.rerank_score !== undefined && <span>Rerank {String(hit.rerank_score)}</span>}
                                        {hit.file_name && <span>{hit.file_name}</span>}
                                        {hit.chunk_id && <span>{hit.chunk_id}</span>}
                                        <span
                                          className={`rounded-full px-2 py-0.5 ${hit.matched ? "bg-emerald-500/15 text-emerald-200" : "bg-white/5 text-slate-400"
                                            }`}
                                        >
                                          {hit.matched ? "Matched" : "Missed"}
                                        </span>
                                      </div>
                                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                                        {hit.text}
                                      </p>
                                      {hit.matched && (
                                        <div className="mt-2 text-xs text-emerald-200">
                                          Best match: {hit.best_match_fragment} ({hit.best_match_ratio.toFixed(4)})
                                        </div>
                                      )}
                                      <div className="mt-3 space-y-2">
                                        {hit.matches.map((m) => (
                                          <div
                                            key={m.golden_fragment}
                                            className={`rounded-xl px-3 py-2 text-xs ${m.matched ? "bg-emerald-500/10 text-emerald-200" : "bg-white/5 text-slate-300"
                                              }`}
                                          >
                                            <div className="font-medium">{m.matched ? "Matched" : "Missed"}</div>
                                            <div className="mt-1">fragment: {m.golden_fragment}</div>
                                            <div className="mt-1">ratio: {m.best_ratio.toFixed(4)}</div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </section>
            </section>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Back to top"
        className="fixed bottom-6 right-6 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-slate-900/90 text-white shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:bg-slate-800"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </main>
  );
}
