"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SearchResult, UsageInfo } from "./types";
import AppShell from "./components/AppShell";
import SearchTab from "./components/SearchTab";

const API_BASE = process.env.NEXT_PUBLIC_KNOWLEDGE_LIB_API_BASE || "http://localhost:8000";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatSession = {
  id: string;
  title: string;
};

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

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [usedResults, setUsedResults] = useState<SearchResult[] | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState("new");
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceItems, setSourceItems] = useState<any[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourcesByMessageId, setSourcesByMessageId] = useState<Record<string, SearchResult[]>>({});
  const [citationsByMessageId, setCitationsByMessageId] = useState<
    Record<string, { rank: number; chunk_id?: string; quote_text?: string; file_name?: string; score?: number | null }[]>
  >({});

  const filteredResults = usedResults === null ? results : usedResults;
  const usageText = usage ? `tokens: ${usage.total_tokens ?? "-"}` : undefined;
  const shouldShowSourcePanel =
    sourceLoading || selectedSourceId !== null || sourceItems.length > 0;

  const resetConversation = () => {
    setQuery("");
    setMessages([]);
    setResults([]);
    setUsedResults(null);
    setUsage(null);
    setSearchError(null);
    setSearchDone(false);
    setWarning(null);
    setSelectedSourceId(null);
    setSourceItems([]);
    setSourcesByMessageId({});
    setCitationsByMessageId({});
  };

  const fetchChats = async () => {
    try {
      const res = await fetch(`${API_BASE}/chats`);
      if (!res.ok) return;
      const data = await res.json();
      setChatSessions(data.chats || []);
    } catch {
      // ignore
    }
  };

  const loadChat = async (chatId: string) => {
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`);
      if (!res.ok) return;
      const data = await res.json();
      const nextMessages = (data.messages || []).map((item: any) => ({
        id: item.id,
        role: item.role,
        content: item.content,
      }));
      const nextCitations: Record<
        string,
        { rank: number; chunk_id?: string; quote_text?: string; file_name?: string; score?: number | null }[]
      > = {};
      (data.messages || []).forEach((item: any) => {
        if (item.citations?.length) {
          nextCitations[item.id] = item.citations.map((c: any) => ({
            rank: c.rank,
            chunk_id: c.chunk_id,
            quote_text: c.quote_text,
            file_name: c.file_name,
            score: c.score ?? null,
          }));
        }
      });
      if (data.stats?.warn) {
        setWarning("接近对话阈值，历史消息将被压缩。");
      } else {
        setWarning(null);
      }
      setSelectedSourceId(null);
      setSourceItems([]);
      setSourceLoading(false);
      setSourcesByMessageId({});
      setCitationsByMessageId(nextCitations);
      setMessages(nextMessages);
      setActiveChatId(chatId);
      setResults([]);
      setUsedResults(null);
      setUsage(null);
      setSearchError(null);
      setSearchDone(false);
    } catch {
      // ignore
    }
  };

  const refreshChatStats = async (chatId: string) => {
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.stats?.warn) {
        setWarning("接近对话阈值，历史消息将被压缩。");
      } else {
        setWarning(null);
      }
    } catch {
      // ignore
    }
  };

  const loadSourceByFileId = async (fileId: string | null) => {
    if (!fileId) return;
    setSelectedSourceId(fileId);
    setSourceLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sources/${fileId}?limit=3`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSourceItems(data.items || []);
    } catch {
      setSourceItems([]);
    } finally {
      setSourceLoading(false);
    }
  };

  const loadSourceByChunkId = async (chunkId: string | null) => {
    if (!chunkId) return;
    setSelectedSourceId(chunkId);
    setSourceLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chunks/${chunkId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSourceItems(data.chunk ? [data.chunk] : []);
    } catch {
      setSourceItems([]);
    } finally {
      setSourceLoading(false);
    }
  };

  const createChat = async () => {
    const res = await fetch(`${API_BASE}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || "创建对话失败");
    }
    const data = await res.json();
    const nextChat = { id: data.id, title: data.title } as ChatSession;
    setChatSessions((prev) => [nextChat, ...prev]);
    setActiveChatId(nextChat.id);
    return nextChat.id;
  };

  const renameChat = async (chatId: string, title: string) => {
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) return;
      setChatSessions((prev) =>
        prev.map((item) => (item.id === chatId ? { ...item, title } : item))
      );
    } catch {
      // ignore
    }
  };

  const deleteChat = async (chatId: string) => {
    if (!window.confirm("确定要删除该对话吗？此操作不可恢复。")) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setChatSessions((prev) => prev.filter((item) => item.id !== chatId));
      if (activeChatId === chatId) {
        router.push("/");
        resetConversation();
        setActiveChatId("new");
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchChats();
  }, []);

  useEffect(() => {
    const chatId = searchParams.get("chat");
    if (chatId) {
      loadChat(chatId);
    } else {
      setActiveChatId("new");
      resetConversation();
    }
  }, [searchParams]);

  const handleSearch = async () => {
    setSearchError(null);
    setResults([]);
    setUsedResults(null);
    setUsage(null);
    setSearchDone(false);
    setSelectedSourceId(null);
    setSourceItems([]);

    const nextQuery = query.trim();
    if (!nextQuery) {
      setSearchError("请输入检索词");
      return;
    }

    let chatId = activeChatId;
    if (activeChatId === "new") {
      try {
        chatId = await createChat();
        setActiveChatId(chatId);
      } catch (err) {
        if (err instanceof Error) {
          setSearchError(err.message || "创建对话失败");
        } else {
          setSearchError("创建对话失败");
        }
        return;
      }
    }

    setQuery("");
    setSearching(true);
    const timeKey = Date.now();
    const assistantId = `assistant-${timeKey}`;
    setMessages((prev) => [
      ...prev,
      { id: `user-${timeKey}`, role: "user", content: nextQuery },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    try {
      const res = await fetch(`${API_BASE}/search/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: nextQuery, top_k: 5, chat_id: chatId }),
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
          const lines = part
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
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
            setSourcesByMessageId((prev) => ({ ...prev, [assistantId]: nextResults }));
          } else if (eventName === "used_results") {
            setUsedResults(payload.results || []);
            const indices = payload.indices || [];
            const citations = (payload.results || []).map((item: any, idx: number) => ({
              rank: indices[idx] ?? idx + 1,
              chunk_id: item.chunk_id,
              quote_text: item.quote_text ?? item.text,
              file_name: item.file_name,
              score: item.score ?? null,
            }));
            if (citations.length > 0) {
              setCitationsByMessageId((prev) => ({ ...prev, [assistantId]: citations }));
            }
          } else if (eventName === "delta") {
            const content = payload.content || "";
            if (content) {
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? { ...item, content: `${item.content}${content}` }
                    : item
                )
              );
            }
          } else if (eventName === "usage") {
            setUsage(Object.keys(payload).length > 0 ? payload : null);
          } else if (eventName === "error") {
            setSearchError(payload.message || "检索失败");
          } else if (eventName === "done") {
            setSearchDone(true);
          }
        }
      }
      fetchChats();
      if (chatId !== "new") {
        refreshChatStats(chatId);
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

  const rightPanel = (
    <aside className="order-last rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)] xl:order-none">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700">来源详情</div>
        <div className="text-[11px] text-slate-400">{filteredResults.length} 条</div>
      </div>

      {!shouldShowSourcePanel && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
          点击引用后显示原文详情。
        </div>
      )}

      {shouldShowSourcePanel && (
        <div className="mt-4 space-y-4">
          {filteredResults.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-700">引用来源</div>
              <div className="mt-2 space-y-2 text-xs">
                {filteredResults.map((item, index) => (
                  <button
                    key={`${item.file_id ?? "unknown"}-${index}`}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${selectedSourceId === item.file_id
                        ? "border-slate-300 bg-slate-100 text-slate-900"
                        : "border-slate-200/70 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    type="button"
                    onClick={() => loadSourceByFileId(item.file_id ?? null)}
                  >
                    <div className="truncate font-medium text-slate-900">
                      {item.file_name || "未知来源"}
                    </div>
                    <div className="text-[11px] text-slate-400">来源 {index + 1}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-slate-700">原文预览</div>
            <div className="mt-2 max-h-72 space-y-3 overflow-y-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              {sourceLoading && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                  加载中...
                </div>
              )}
              {!sourceLoading && selectedSourceId === null && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                  点击引用来源查看原文。
                </div>
              )}
              {!sourceLoading && selectedSourceId !== null && sourceItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                  未加载到原文片段。
                </div>
              )}
              {!sourceLoading &&
                sourceItems.map((item, index) => (
                  <div
                    key={`${item.id ?? "source"}-${index}`}
                    className="space-y-2 rounded-2xl border border-slate-200/60 bg-white p-3"
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      {item.file_name || "未知来源"}
                    </div>
                    {isTableText(item.text) ? (
                      <pre className="whitespace-pre-wrap font-mono">{item.text}</pre>
                    ) : (
                      <div className="whitespace-pre-wrap">
                        {(() => {
                          const { title, body } = formatResultText(item.text || "");
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
                ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <AppShell
      activeSection="chat"
      chatSessions={chatSessions}
      activeChatId={activeChatId}
      rightPanel={rightPanel}
      onNewChat={() => {
        resetConversation();
        setActiveChatId("new");
      }}
      onSelectChat={(chatId) => {
        loadChat(chatId);
      }}
      onRenameChat={renameChat}
      onDeleteChat={deleteChat}
    >
      {({ activeChatTitle }) => (
        <div className="h-[calc(100vh-160px)] min-h-0">
          <SearchTab
            title={activeChatTitle}
            query={query}
            onQueryChange={setQuery}
            onSearch={handleSearch}
            onSearchKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (!searching) {
                void handleSearch();
              }
            }}
            searching={searching}
            searchError={searchError}
            warning={warning}
            onCitationClick={(ref, messageId) => {
              if (!ref) return;
              if (!Number.isNaN(Number(ref))) {
                const index = Number(ref);
                const local = messageId ? sourcesByMessageId[messageId] : undefined;
                const source = local?.[index - 1];
                if (source?.chunk_id) {
                  loadSourceByChunkId(source.chunk_id);
                  return;
                }
                const citation = messageId ? citationsByMessageId[messageId]?.find((item) => item.rank === index) : undefined;
                if (citation?.chunk_id) {
                  loadSourceByChunkId(citation.chunk_id);
                }
                return;
              } else {
                loadSourceByChunkId(ref);
                return;
              }
            }}
            messages={messages}
            usageText={usageText}
            citationsByMessageId={citationsByMessageId}
          />
        </div>
      )}
    </AppShell>
  );
}
