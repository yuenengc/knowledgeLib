# AGENTS.md

## RAG Flow

- Upload and indexing prepare the knowledge base before chat answers are generated.
- Search requests first persist the user message when a chat is active, then retrieve sources, then stream the answer.
- Retrieval results are sent to the frontend before answer deltas so the UI can show candidate sources immediately.
- LLM answers must be grounded in retrieved sources and should preserve the citation contract used by the frontend.
- Empty retrieval should produce a no-results answer path without inventing unsupported content.

## Chunk Strategy

- Keep the parent/child chunk model intact.
- Parent nodes represent larger document sections for source context and citation preview.
- Child chunks are the retrieval/indexing granularity and point back to their parent section.
- SQLite stores both parent and child chunk records needed for source lookup, BM25, and citation validation.
- Vector indexing should use child chunks while preserving enough metadata to recover parent context.
- Section titles are semantic metadata; operational metadata such as paths, IDs, and structural flags should not pollute embedding text.
- Document parsing should avoid indexing table-of-contents-like noise when it can be identified safely.

## Retrieval Strategy

- Retrieval is hybrid: semantic vector retrieval and keyword-oriented BM25 retrieval both matter.
- Vector results should be expanded to parent context before final answer generation when parent links are available.
- BM25 should operate over stored child chunks and may use parent text for answer context.
- Fusion should deduplicate by stable chunk or parent identifiers before selecting final LLM sources.
- Do not replace the hybrid retrieval path with a single retriever unless the user explicitly asks for an architecture change.
- Keep retrieval limits and thresholds configurable rather than hardcoded around one dataset.
- Keep RAG tuning constants such as top-k values, fusion limits, rerank thresholds, and rerank model choices centralized in `backend/settings.py`.

## Rerank Strategy

- Rerank is a second-stage filter over fused candidates, not a replacement for hybrid retrieval.
- If the reranker is unavailable, retrieval should still degrade to fused candidates.
- Rerank scores may be normalized for comparison, but raw scores should remain useful for debugging.
- Final answer context should come from reranked and deduplicated candidates.

## Citation Strategy

- Citations are derived from the source numbers actually used in the generated answer.
- Persist assistant messages separately from citation rows.
- Validate cited chunk IDs against stored chunks before writing citation records.
- Store short quote excerpts for display; avoid saving or rendering unnecessarily long source passages.
- Keep citation ranks aligned with the answer-visible citation numbers.
- Frontend citation clicks depend on chunk IDs and the streaming `used_results` payload.

## Upload And Indexing Strategy

- Upload requests should save the raw file, create metadata, return a task ID, and let background ingestion continue.
- Background ingestion should parse, chunk, embed, store vector nodes, store SQLite chunks, and finally mark the file ready.
- Failed ingestion should mark the file as error, remove the failed upload artifact when appropriate, and expose the task error.
- Re-uploading the same filename should remove previous versions from vector storage, SQLite metadata, and disk before the new version becomes authoritative.
- Keep embedding and heavy index initialization lazy enough that upload can return quickly.
- Do not make the request thread wait for full parsing, embedding, or vector storage.

## Data Consistency

- Files, chunks, vector nodes, chats, messages, and citations are related state and must be updated consistently.
- Deleting a file must remove its vector nodes, chunk metadata, file metadata, and uploaded file artifact.
- Clearing the knowledge base must clear vector data and SQLite metadata in a foreign-key-safe order.
- Chat deletion should rely on message and citation cleanup through the existing persistence model.
- Citation rows must not reference missing chunks.
- SQLite writes should continue to use the existing write-lock pattern.

## Development Constraints

- Keep backend concerns separated: API routing, persistence, ingestion, indexing, retrieval, and background work should stay in their existing ownership areas.
- Keep frontend API calls aligned with backend response shapes and streaming event contracts.
- Prefer existing modules, helpers, types, and UI conventions before adding new abstractions.
- Keep changes scoped to the requested behavior; avoid unrelated refactors or formatting churn.
- Add new backend constants to `backend/settings.py` when they affect retrieval, ranking, indexing, model behavior, or environment-dependent behavior.
- Review existing Chinese text encoding before editing copy or prompts.
- Do not revert unrelated working tree changes.

## Testing And Verification

- Run the narrowest meaningful verification for the touched area.
- For frontend changes, run a production build check when practical.
- For backend changes, exercise affected API paths or add focused tests when behavior changes.
- For ingestion or retrieval changes, verify at least one end-to-end path from upload/indexing to cited answer when practical.
- If a verification step cannot be run, state the reason and the remaining risk.

## Workflow

- Read the relevant files before proposing or editing.
- Identify whether the change affects data consistency, streaming behavior, citations, or destructive operations.
- Make small, reviewable edits.
- After editing, inspect the diff and run appropriate verification.
- Report changed files, verification results, and any follow-up risks.

## Safety

- Treat clear, rebuild, delete, and data-directory cleanup operations as destructive.
- Do not run destructive cleanup scripts unless the user explicitly asks for that operation.
- Avoid commands that remove indexed data, uploaded files, chats, or metadata unless that is the requested task.
- Preserve user data and existing local state by default.
