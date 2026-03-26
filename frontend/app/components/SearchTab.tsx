import { useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SearchResult } from "../types";

type CodeProps = React.HTMLAttributes<HTMLElement> & { inline?: boolean };

const markdownComponents: Components = {
  p: ({ children, ...props }) => (
    <p className="text-sm leading-6 text-slate-600" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-slate-900" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-slate-700" {...props}>
      {children}
    </em>
  ),
  h1: ({ children, ...props }) => (
    <h3 className="text-sm font-semibold text-slate-900" {...props}>
      {children}
    </h3>
  ),
  h2: ({ children, ...props }) => (
    <h4 className="text-sm font-semibold text-slate-900" {...props}>
      {children}
    </h4>
  ),
  h3: ({ children, ...props }) => (
    <h5 className="text-sm font-semibold text-slate-900" {...props}>
      {children}
    </h5>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => <li {...props}>{children}</li>,
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-2 border-dashed border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
      {...props}
    >
      {children}
    </blockquote>
  ),
  code: ({ inline, children, ...props }: CodeProps) =>
    inline ? (
      <code className="rounded-md bg-slate-100 px-1 py-0.5 text-xs text-slate-700" {...props}>
        {children}
      </code>
    ) : (
      <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
        <code {...props}>{children}</code>
      </pre>
    ),
};

type SearchTabProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  searching: boolean;
  searchError: string | null;
  answer: string;
  results: SearchResult[];
  expandedSources: Record<string, boolean>;
  onToggleSource: (key: string) => void;
};

export default function SearchTab({
  query,
  onQueryChange,
  onSearch,
  onSearchKeyDown,
  searching,
  searchError,
  answer,
  results,
}: SearchTabProps) {
  const [openDialog, setOpenDialog] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-10 w-full flex-1 rounded-lg border border-slate-200/60 bg-white px-3 text-sm text-slate-900 shadow-sm"
          placeholder="输入检索词"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <button
          className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onSearch}
          disabled={searching}
        >
          {searching ? "检索中..." : "开始检索"}
        </button>
      </div>

      {searchError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{searchError}</div>}

      {(answer || results.length > 0) && (
        <div className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm">
          {answer && (
            <div className="space-y-3">
              <div className="border-l-[3px] border-blue-600 pl-3">
                <h4 className="text-sm font-semibold text-slate-900">参考答案</h4>
                <div className="mt-2 text-sm text-slate-600">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {answer}
                  </ReactMarkdown>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700">Point 1</span>
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700">Point 2</span>
              </div>
            </div>
          )}
          {results.length > 0 && (
            <div className="mt-4">
              <button
                className="text-xs font-medium text-blue-600"
                onClick={() => setOpenDialog(true)}
              >
                查看原文
              </button>
            </div>
          )}
        </div>
      )}

      {results.length === 0 && !searching && !searchError && !answer && (
        <p className="text-xs text-slate-500">输入关键词开始检索。</p>
      )}

      {openDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200/60 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h4 className="text-sm font-semibold text-slate-900">检索原文</h4>
              <button className="text-xs text-slate-500" onClick={() => setOpenDialog(false)}>
                关闭
              </button>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
              {results.map((item, index) => (
                <div key={`${item.file_id ?? "unknown"}-${index}`} className="rounded-xl border border-slate-200/60 bg-slate-50/60 p-3">
                  <div className="text-xs font-semibold text-slate-900">{item.file_name || "未知来源"}</div>
                  <div className="mt-2 text-xs text-slate-600 whitespace-pre-wrap">{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
