"use client";

import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bell,
  FileText,
  Search,
  Trash2,
  Upload,
  UserCircle,
  X,
} from "lucide-react";
import type { FileItem, SearchResult, UsageInfo } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_KNOWLEDGE_LIB_API_BASE || "http://localhost:8000";

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatResultText(text: string) {
  const normalizedNewlines = text.replace(/\r\n/g, "\n");
  const deDotted = normalizedNewlines.replace(/[.·•]{5,}/g, " ");
  const normalized = deDotted.replace(/([。！？；])[ \t]*/g, "$1\n\n").trim();
  if (/\d+\.\s+/.test(normalized)) {
    return { title: "", body: normalized };
  }
  const lines = normalized
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => !/^\d+(\.\d+)*\.?$/.test(line));
  const title = lines.shift() || "";
  const body = lines.join("\n");
  return { title, body };
}

function isTableText(text: string) {
  return /\|.+\|/.test(text) && /\n\|?[-: ]+\|/.test(text);
}

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

export default function Home() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearStatus, setClearStatus] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const fetchFiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/files`);
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  useEffect(() => {
    if (!activeFileId && files.length > 0) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId]);

  const handleUpload = async () => {
    setUploadError(null);
    setUploadStatus(null);
    setClearStatus(null);
    setClearError(null);

    if (!selectedFile) {
      setUploadError("请先选择文件");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "上传失败");
      }

      const data = await res.json();
      setUploadStatus(`上传成功: ${data.filename}`);
      setSelectedFile(null);
      await fetchFiles();
    } catch (err) {
      if (err instanceof Error) {
        setUploadError(err.message || "上传失败");
      } else {
        setUploadError("上传失败");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleClearAll = async () => {
    setClearError(null);
    setClearStatus(null);

    if (!window.confirm("确定要清空所有历史上传记录吗？此操作不可恢复。")) {
      return;
    }

    setClearing(true);
    try {
      const res = await fetch(`${API_BASE}/clear`, { method: "POST" });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "清空失败");
      }
      const data = await res.json();
      setClearStatus(`已清空 ${data.files ?? 0} 个文件`);
      setResults([]);
      setAnswer("");
      setUsage(null);
      setSelectedResult(null);
      await fetchFiles();
    } catch (err) {
      if (err instanceof Error) {
        setClearError(err.message || "清空失败");
      } else {
        setClearError("清空失败");
      }
    } finally {
      setClearing(false);
    }
  };

  const handleSearch = async () => {
    setSearchError(null);
    setResults([]);
    setAnswer("");
    setUsage(null);
    setSelectedResult(null);

    if (!query.trim()) {
      setSearchError("请输入检索词");
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/search/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, top_k: 5 }),
      });

      if (!res.ok || !res.body) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "检索失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n").map((line) => line.trim()).filter(Boolean);
          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          const dataText = dataLines.join("\n");
          if (!dataText) continue;
          let payload: any = {};
          try {
            payload = JSON.parse(dataText);
          } catch {
            payload = { content: dataText };
          }

          if (eventName === "results") {
            const nextResults = payload.results || [];
            setResults(nextResults);
            if (nextResults.length > 0) {
              setSelectedResult(nextResults[0]);
            }
          } else if (eventName === "delta") {
            const content = payload.content || "";
            if (content) {
              setAnswer((prev) => prev + content);
            }
          } else if (eventName === "usage") {
            setUsage(Object.keys(payload).length > 0 ? payload : null);
          } else if (eventName === "error") {
            setSearchError(payload.message || "检索失败");
          }
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        setSearchError(err.message || "检索失败");
      } else {
        setSearchError("检索失败");
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!searching) {
      void handleSearch();
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-teal-500 text-xs font-semibold text-white">
              KB
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Enterprise Knowledge Base</div>
              <div className="text-xs text-slate-500">基于语义检索的企业级智能文档中心</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/60 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
              v0.1.0
            </span>
            <button className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200/60 bg-white text-slate-600 shadow-sm">
              <Bell className="h-4 w-4" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200/60 bg-white text-slate-600 shadow-sm">
              <UserCircle className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-6 px-6 py-8 lg:grid-cols-[260px_1fr_320px]">
        <aside className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">文档上传</h3>
              <p className="text-xs text-slate-500">支持 PDF / Word / PPT</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200/60 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
                <Upload className="h-4 w-4" />
                选择文件
                <input
                  type="file"
                  hidden
                  accept=".pdf,.docx,.pptx"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>
              <span className="text-xs text-slate-500">{selectedFile ? selectedFile.name : "未选择文件"}</span>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleUpload}
                disabled={uploading}
              >
                <FileText className="h-4 w-4" />
                {uploading ? "上传中..." : "开始上传"}
              </button>
            </div>

            {uploadStatus && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {uploadStatus}
              </div>
            )}
            {uploadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {uploadError}
              </div>
            )}
            {clearStatus && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {clearStatus}
              </div>
            )}
            {clearError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {clearError}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs font-semibold text-slate-700">历史记录</div>
              {files.length > 0 && (
                <button
                  className="inline-flex items-center gap-1 text-xs text-red-500"
                  onClick={handleClearAll}
                  disabled={clearing || uploading}
                >
                  <Trash2 className="h-4 w-4" />
                  {clearing ? "清空中" : "清空"}
                </button>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/60 bg-white">
              {files.length === 0 && (
                <div className="px-3 py-3 text-xs text-slate-500">暂无文件</div>
              )}
              {files.map((file) => {
                const isActive = activeFileId === file.id;
                return (
                  <button
                    key={file.id}
                    className={`flex w-full items-start justify-between gap-2 border-b border-slate-200/60 px-3 py-2 text-left text-xs last:border-b-0 ${isActive ? "bg-blue-50/50" : "bg-white"
                      }`}
                    onClick={() => setActiveFileId(file.id)}
                    type="button"
                  >
                    <div>
                      <div className="font-medium text-slate-900">{file.filename}</div>
                      <div className="text-[11px] text-slate-500">{formatTimestamp(file.uploaded_at)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-slate-200/60 bg-white px-3 shadow-sm">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  className="w-full text-sm text-slate-900 outline-none"
                  placeholder="输入检索词"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              <button
                className="h-10 rounded-lg bg-blue-600 px-4 text-xs font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? "检索中..." : "开始检索"}
              </button>
            </div>

            {searchError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {searchError}
              </div>
            )}

            {(answer || searching) && (
              <div className="mt-4 rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm">
                <div className="border-l-[3px] border-blue-600 pl-3">
                  <div className="text-sm font-semibold text-slate-900">参考答案</div>
                  <div className="mt-2 text-sm text-slate-600">
                    {searching && !answer ? (
                      <div className="flex items-center text-slate-500">
                        <span className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                        </span>
                      </div>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {answer}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>

              </div>
            )}

            {!answer && !searching && !searchError && (
              <div className="mt-4 text-xs text-slate-500">输入关键词开始检索。</div>
            )}
          </div>

          {usage && (
            <div className="text-[11px] text-slate-500">
              tokens: {usage.total_tokens ?? "-"}
            </div>
          )}
        </section>

        <aside className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">详情面板</div>
            <button className="text-slate-400" type="button">
              <X className="h-4 w-4" />
            </button>
          </div>

          {!selectedResult && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">
              {searching ? (
                <div className="flex items-center text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                  </span>
                </div>
              ) : (
                "请选择检索结果查看详情。"
              )}
            </div>
          )}

          {selectedResult && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-700">原文预览</div>
                <div className="mt-2 max-h-72 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  {isTableText(selectedResult.text) ? (
                    <pre className="whitespace-pre-wrap font-mono">{selectedResult.text}</pre>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {(() => {
                        const { title, body } = formatResultText(selectedResult.text);
                        return (
                          <>
                            {title && <div className="font-medium text-slate-900">{title}</div>}
                            {body ? `\n\n${body}` : ""}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700">元数据</div>
                <div className="mt-2 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-slate-500 font-medium whitespace-nowrap">文件名</div>
                    <div className="text-slate-900">{selectedResult.file_name || "未知"}</div>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-slate-500 font-medium whitespace-nowrap">路径</div>
                    <div className="text-slate-900 font-mono break-all">{selectedResult.source_path || "-"}</div>
                  </div>
                  {selectedResult.score !== null && (
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-slate-500 font-medium">Score</div>
                      <div className="text-slate-900">{selectedResult.score.toFixed(4)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
