import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, SendHorizontal, ThumbsDown, ThumbsUp, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation";
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
  searchDone: boolean;
  searchError: string | null;
  searchPhase?: "idle" | "retrieving" | "reasoning" | "generating";
  warning?: string | null;
  onCitationClick?: (chunkId: string, messageId?: string) => void;
  citationsByMessageId?: Record<
    string,
    { rank: number; chunk_id?: string; quote_text?: string; file_name?: string }[]
  >;
  messages: ChatMessage[];
  usageText?: string;
  sourceCount?: number;
};

type CitationItem = {
  rank: number;
  chunk_id?: string;
  quote_text?: string;
  file_name?: string;
};

export default function SearchTab({
  title,
  query,
  onQueryChange,
  onSearch,
  onSearchKeyDown,
  searching,
  searchDone,
  searchError,
  searchPhase = "idle",
  warning,
  onCitationClick,
  citationsByMessageId,
  messages,
  usageText,
  sourceCount,
}: SearchTabProps) {
  const router = useRouter();
  const hasMessages = messages.length > 0;
  const hasSources = typeof sourceCount !== "number" || sourceCount > 0;
  const isSourceCountLoading = typeof sourceCount !== "number";
  const endRef = useRef<HTMLDivElement | null>(null);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, "up" | "down" | null>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const suggestions = useMemo(
    () => ["年休假有多少天", "公司有哪些福利？", "如何申请病假"],
    []
  );

  const markdownComponents = useMemo<Components>(
    () => ({
      p: ({ children, ...props }) => (
        <p className="text-[14px] leading-6 text-slate-700" {...props}>
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
        <ul className="list-disc space-y-2 pl-5 text-[14px] leading-6 text-slate-700" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="list-decimal space-y-2 pl-5 text-[14px] leading-6 text-slate-700" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => <li {...props}>{children}</li>,
      blockquote: ({ children, ...props }) => (
        <blockquote
          className="rounded-lg border-l-2 border-blue-300 bg-blue-50 px-3 py-2 text-[14px] leading-6 text-slate-700"
          {...props}
        >
          {children}
        </blockquote>
      ),
      code: ({ className, children, ...props }) => {
        const isBlock = Boolean(className?.includes("language-"));
        return isBlock ? (
          <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-[12px] text-slate-700">
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
        ) : (
          <code className="rounded-md bg-slate-100 px-1 py-0.5 text-[12px] text-slate-700" {...props}>
            {children}
          </code>
        );
      },
      a: ({ href, children, ...props }) => (
        <a
          className="cursor-pointer font-medium text-blue-700 underline underline-offset-2"
          data-href={href}
          href={href || "#"}
          onClick={(event) => {
            if (!href?.startsWith("source:")) return;
            event.preventDefault();
          }}
          {...props}
        >
          {children}
        </a>
      ),
    }),
    [onCitationClick]
  );


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
    const headingSplit = content.split(/\n#{1,6}\s*(引用|参考资料|参考文献)[\s\S]*$/m);
    const colonSplit = headingSplit[0].split(/\n(?:引用|参考资料|参考文献)[:：][\s\S]*$/m);
    return colonSplit[0]?.trim() ?? content;
  };

  const groupCitationsByFile = (items: CitationItem[]) => {
    const groups: { fileName: string; items: CitationItem[] }[] = [];
    const indexByFile = new Map<string, number>();

    items.forEach((item) => {
      const fileName = item.file_name || "未知来源";
      const groupIndex = indexByFile.get(fileName);
      if (groupIndex === undefined) {
        indexByFile.set(fileName, groups.length);
        groups.push({ fileName, items: [item] });
      } else {
        groups[groupIndex].items.push(item);
      }
    });

    return groups;
  };

  useEffect(() => {
    if (!hasMessages) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, searching, hasMessages]);

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1500);
    } catch {
      // ignore
    }
  };

  const searchPhaseLabel =
    searchPhase === "retrieving"
      ? "正在检索相关来源..."
      : searchPhase === "reasoning"
        ? "正在整理检索结果..."
        : searchPhase === "generating"
          ? "正在生成回答..."
          : "";

  const renderSearchComposer = (compact = false) => (
    <div className={compact ? "w-full" : "mx-auto max-w-[900px]"}>
      {warning && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
          {warning}
        </div>
      )}
      {searchError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
          {searchError}
        </div>
      )}
      <div className="flex items-center gap-3 relative border border-slate-200 bg-white p-3 pl-6 rounded-[32px] transition focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-50">
        <div className="shrink-0 flex items-center gap-2 text-[12px] font-medium text-slate-500">
          {typeof sourceCount === "number" ? (
            <>
              <button
                className="transition hover:text-slate-900"
                type="button"
                onClick={() => router.push("/upload")}
                aria-label="前往知识库上传页面"
              >
                {sourceCount} sources
              </button>
              <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
            </>
          ) : (
            <span className="h-1 w-1 rounded-full bg-transparent" aria-hidden="true" />
          )}
        </div>
        <textarea
          className="grow resize-none bg-transparent text-[16px] leading-7 text-slate-900 outline-none placeholder:text-slate-400"
          placeholder="向知识库提问... (Shift + Enter 换行)"
          value={query}
          rows={1}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <button
          className="bottom-4 right-4 flex h-[32px] w-[32px] items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          onClick={onSearch}
          disabled={searching}
          aria-label="发送"
          type="button"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const renderHomeSkeleton = () => (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-stretch gap-6 -mt-[80px]">
      <div className="text-center">
        <div className="mx-auto h-8 w-64 animate-pulse rounded-full bg-slate-100" />
        <div className="mx-auto mt-3 h-4 w-80 max-w-full animate-pulse rounded-full bg-slate-100" />
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {[0, 1, 2].map((index) => (
          <div
            key={`skeleton-card-${index}`}
            className="flex min-h-[88px] w-[220px] flex-col justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
          >
            <div className="h-3 w-16 animate-pulse rounded-full bg-slate-100" />
            <div className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
              <div className="h-4 w-[72%] animate-pulse rounded-full bg-slate-100" />
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto w-full max-w-[900px]">
        <div className="flex items-center gap-3 rounded-[32px] border border-slate-200 bg-white p-3 pl-6">
          <div className="h-4 w-20 animate-pulse rounded-full bg-slate-100" />
          <div className="h-5 flex-1 animate-pulse rounded-full bg-slate-100" />
          <div className="h-8 w-8 rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  );



  return (
    <div className="flex h-full flex-col bg-white">
      {/* <div className="flex h-[56px] shrink-0 items-center justify-between border-b border-slate-200 px-8">
        <div className="flex items-center gap-3 text-sm font-bold text-slate-900">
          <span>当前对话：{title}</span>
        </div>
        {usageText && <div className="text-[12px] text-slate-400">{usageText}</div>}
      </div> */}

      <div className={`flex-1 overflow-y-auto px-8 ${hasMessages ? "pt-10 pb-20" : "flex items-center justify-center py-10"}`}>
        {!hasMessages ? (
          isSourceCountLoading ? (
            renderHomeSkeleton()
          ) : hasSources ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col items-stretch gap-6 -mt-[80px]">
              <div className="text-center">
                <div className="text-2xl font-semibold text-slate-900">今天想了解什么？</div>
                <div className="mt-2 text-sm text-slate-500">输入问题，或选择一个提示快速生成。</div>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="group flex min-h-[88px] w-[220px] flex-col justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
                    onClick={() => onQueryChange(item)}
                  >
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Prompt</div>
                    <div className="line-clamp-2 text-sm font-medium leading-6 text-slate-800 transition group-hover:text-slate-950">
                      {item}
                    </div>
                  </button>
                ))}
              </div>
              {renderSearchComposer(true)}
            </div>
          ) : (
            <div className="mx-auto -mt-[80px] flex w-full max-w-3xl flex-col items-center rounded-[2rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center shadow-sm">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm">
                <Upload className="h-6 w-6" />
              </div>
              <div className="text-2xl font-semibold text-slate-900">知识库还是空的</div>
              <div className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
                先上传文档，系统才能基于你的资料进行检索和回答。
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white transition hover:bg-blue-500"
                  onClick={() => router.push("/upload")}
                >
                  <Upload className="h-4 w-4" />
                  去上传文档
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="mx-auto max-w-[840px] space-y-8">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`last:pb-0 ${message.role === "user"
                  ? "flex justify-end"
                  : "pb-8 border-b border-slate-100 last:border-b-0"
                  }`}
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[68%] rounded-[1.5rem] bg-slate-100 px-5 py-3 text-[16px] leading-7 text-black"
                      : "text-[18px] leading-8 text-slate-900"
                  }
                >
                  {message.role === "assistant" ? (
                    message.content ? (
                      <div
                        data-message-id={message.id}
                        onClick={(event) => {
                          const target = event.target as HTMLElement | null;
                          if (!target) return;
                          const link = target.closest("[data-href]");
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
                          <div className="mt-4 space-y-3 text-[12px] text-slate-600">
                            <div className="font-semibold text-slate-500">引用</div>
                            <div className="space-y-3">
                              {groupCitationsByFile(citationsByMessageId[message.id]).map((group) => (
                                <div key={`${message.id}-${group.fileName}`} className="space-y-1.5">
                                  <div className="truncate font-semibold text-slate-900">{group.fileName}</div>
                                  <div className="space-y-1">
                                    {group.items.map((item) => (
                                      <button
                                        key={`${message.id}-${item.rank}`}
                                        className="flex w-full gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-left text-slate-700 transition hover:bg-blue-50"
                                        type="button"
                                        onClick={() => {
                                          const ref = item.chunk_id || String(item.rank);
                                          onCitationClick?.(ref, message.id);
                                        }}
                                      >
                                        <span className="shrink-0 font-medium text-blue-700">[{item.rank}]</span>
                                        <span className="line-clamp-2 underline underline-offset-2">
                                          {item.quote_text || "查看引用"}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-4 flex items-center gap-4 text-slate-500">
                          <button
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border-slate-200 bg-white text-[13px] font-medium transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                            type="button"
                            onClick={() => handleCopyMessage(message.id, stripCitationSection(message.content))}
                            aria-label="复制回答"
                            title="复制"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg text-[13px] font-medium transition ${feedbackByMessageId[message.id] === "up"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                              }`}
                            type="button"
                            onClick={() =>
                              setFeedbackByMessageId((prev) => ({
                                ...prev,
                                [message.id]: prev[message.id] === "up" ? null : "up",
                              }))
                            }
                            aria-label="喜欢"
                            title="喜欢"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg text-[13px] font-medium transition ${feedbackByMessageId[message.id] === "down"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                              }`}
                            type="button"
                            onClick={() =>
                              setFeedbackByMessageId((prev) => ({
                                ...prev,
                                [message.id]: prev[message.id] === "down" ? null : "down",
                              }))
                            }
                            aria-label="不喜欢"
                            title="不喜欢"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : searching ? (
                      <div className="space-y-2 text-sm text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                          {searchPhaseLabel || "生成中..."}
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                          系统正在检索文档、筛选证据并组织答案，请稍候。
                        </div>
                      </div>
                    ) : searchDone ? (
                      <span className="text-slate-500">未找到相关信息</span>
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

      {hasMessages && (
        <div className="shrink-0 bg-white px-8 pb-7">
          {renderSearchComposer()}
        </div>
      )}
    </div>
  );
}



