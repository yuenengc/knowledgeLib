import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SendHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type SearchTabProps = {
  title: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  searching: boolean;
  searchError: string | null;
  warning?: string | null;
  onCitationClick?: (chunkId: string, messageId?: string) => void;
  citationsByMessageId?: Record<
    string,
    { rank: number; chunk_id?: string; quote_text?: string; file_name?: string }[]
  >;
  messages: ChatMessage[];
  usageText?: string;
};

export default function SearchTab({
  title,
  query,
  onQueryChange,
  onSearch,
  onSearchKeyDown,
  searching,
  searchError,
  warning,
  onCitationClick,
  citationsByMessageId,
  messages,
  usageText,
}: SearchTabProps) {
  const hasMessages = messages.length > 0;
  const endRef = useRef<HTMLDivElement | null>(null);
  const suggestions = useMemo(
    () => ["概览最新上传的文件", "如何将合同文档结构化？", "生成一份季度复盘摘要"],
    []
  );

  const markdownComponents = useMemo<Components>(
    () => ({
      p: ({ children, ...props }) => (
        <p className="text-[14px] leading-[22px] text-slate-600" {...props}>
          {children}
        </p>
      ),
      strong: ({ children, ...props }) => (
        <strong className="font-semibold text-slate-900" {...props}>
          {children}
        </strong>
      ),
      em: ({ children, ...props }) => (
        <em className="italic text-slate-600" {...props}>
          {children}
        </em>
      ),
      h1: ({ children, ...props }) => (
        <h3 className="text-[16px] font-semibold leading-[24px] text-slate-900" {...props}>
          {children}
        </h3>
      ),
      h2: ({ children, ...props }) => (
        <h4 className="text-[16px] font-semibold leading-[24px] text-slate-900" {...props}>
          {children}
        </h4>
      ),
      h3: ({ children, ...props }) => (
        <h5 className="text-[14px] font-semibold leading-[22px] text-slate-900" {...props}>
          {children}
        </h5>
      ),
      ul: ({ children, ...props }) => (
        <ul className="list-disc space-y-2 pl-5 text-[14px] leading-[22px] text-slate-600" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="list-decimal space-y-2 pl-5 text-[14px] leading-[22px] text-slate-600" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => <li {...props}>{children}</li>,
      blockquote: ({ children, ...props }) => (
        <blockquote
          className="border-l-2 border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[14px] leading-[22px] text-slate-600"
          {...props}
        >
          {children}
        </blockquote>
      ),
      code: ({ inline, children, ...props }) =>
        inline ? (
          <code className="rounded-md bg-slate-100 px-1 py-0.5 text-[12px] text-slate-600" {...props}>
            {children}
          </code>
        ) : (
          <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-[12px] text-slate-600">
            <code {...props}>{children}</code>
          </pre>
        ),
      a: ({ href, children, ...props }) => (
        <button
          className="cursor-pointer bg-transparent p-0 text-blue-700 underline underline-offset-2"
          type="button"
          data-href={href}
          {...props}
        >
          {children}
        </button>
      ),
    }),
    [onCitationClick]
  );

  console.log("--citationsByMessageId", citationsByMessageId);

  const linkifyCitations = (content: string, messageId?: string) => {
    const wrapped = content.replace(/\[(\d+)\]/g, (_match, num) => `【${num}】`);
    const citationMap = messageId ? citationsByMessageId?.[messageId] : undefined;
    return wrapped.replace(
      /^-\s*【(\d+)】\s*(.+)$/gm,
      (_match, num, rest) => {
        const rank = Number(num);
        const match = citationMap?.find((item) => item.rank === rank);
        const ref = match?.chunk_id ? `source:${match.chunk_id}` : `source:${num}`;
        return `- [【${num}】 ${rest}](${ref})`;
      }
    );
  };

  const stripCitationSection = (content: string) => {
    if (!content) return "";
    const parts = content.split("\n### 引用");
    return parts[0]?.trim() ?? content;
  };

  useEffect(() => {
    if (!hasMessages) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, searching, hasMessages]);



  return (
    <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-white/60 px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          {title}
        </div>
        {usageText && <div className="text-[12px] text-slate-500">{usageText}</div>}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        {!hasMessages ? (
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
            <div className="rounded-3xl border border-slate-200/70 bg-white px-8 py-6 shadow-sm">
              <div className="text-2xl font-semibold text-slate-900">今天想从哪里开始？</div>
              <div className="mt-2 text-sm text-slate-500">输入问题，或选择一个提示快速生成。</div>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  onClick={() => onQueryChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-[22px] shadow-sm ${message.role === "user"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200/80 bg-white text-slate-900"
                    }`}
                >
                  {message.role === "assistant" ? (
                    message.content ? (
                      <div
                        data-message-id={message.id}
                        onClick={(event) => {
                          const target = event.target as HTMLElement | null;
                          if (!target) return;
                          const link = target.closest("button[data-href]");
                          const href = link?.getAttribute("data-href") || "";
                          if (!href.startsWith("source:")) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const ref = href.replace("source:", "");
                          const container = target.closest("[data-message-id]") as HTMLElement | null;
                          const messageId = container?.getAttribute("data-message-id") || undefined;
                          if (ref) {
                            onCitationClick?.(ref, messageId);
                          }
                        }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                          urlTransform={(url) => url}
                        >
                          {linkifyCitations(stripCitationSection(message.content), message.id)}
                        </ReactMarkdown>
                        {citationsByMessageId?.[message.id]?.length ? (
                          <div className="mt-3 space-y-2 text-[12px] text-slate-600">
                            <div className="font-semibold text-slate-500">引用</div>
                            <div className="space-y-1">
                              {citationsByMessageId[message.id].map((item) => (
                                <button
                                  key={`${message.id}-${item.rank}`}
                                  className="w-full rounded-lg bg-slate-50 px-2 py-1 text-left text-blue-700 hover:bg-slate-100"
                                  type="button"
                                  onClick={() => {
                                    const ref = item.chunk_id || String(item.rank);
                                    onCitationClick?.(ref, message.id);
                                  }}
                                >
                                  <span className="line-clamp-2 text-slate-700 underline underline-offset-2">
                                    <span className="mr-0 shrink-0 text-blue-700">【{item.rank}】</span>
                                    {item.file_name ? (
                                      <>
                                        <strong className="font-semibold text-slate-900">{`《${item.file_name}》`}</strong>
                                        {item.quote_text ? ` ${item.quote_text}` : ""}
                                      </>
                                    ) : (
                                      item.quote_text || "查看引用"
                                    )}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : searching ? (
                      <div className="flex items-center gap-2 text-slate-500">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
                        生成中...
                      </div>
                    ) : (
                      <span className="text-slate-400">等待响应...</span>
                    )
                  ) : (
                    <span>{message.content}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-white/60 bg-white/90 px-6 py-4">
        {warning && (
          <div className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
            {warning}
          </div>
        )}
        {searchError && (
          <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
            {searchError}
          </div>
        )}
        <div className="relative flex min-h-[56px] items-center rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm transition focus-within:border-slate-900 focus-within:shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
          <textarea
            className="w-full resize-none pr-12 text-[14px] leading-[22px] text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="输入问题或 @ 引用文件..."
            value={query}
            rows={1}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          <button
            className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 active:translate-y-[1px] active:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={onSearch}
            disabled={searching}
            aria-label="发送"
            type="button"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
