"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, X } from "lucide-react";
import type { SearchResult, UsageInfo } from "./types";
import AppShell from "./components/AppShell";
import SearchTab from "./components/SearchTab";

const API_BASE =
  process.env.NEXT_PUBLIC_KNOWLEDGE_LIB_API_BASE || "http://localhost:8000";

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
  const deDotted = normalizedNewlines.replace(/[.。]{5,}/g, " ");
  const normalized = deDotted.replace(/([。！？；])[\t ]*/g, "$1\n\n").trim();
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

export default function HomePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [usedResults, setUsedResults] = useState<SearchResult[] | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState<"idle" | "retrieving" | "reasoning" | "generating">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState("new");
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceItems, setSourceItems] = useState<any[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [sourcesByMessageId, setSourcesByMessageId] = useState<Record<string, SearchResult[]>>({});
  const [citationsByMessageId, setCitationsByMessageId] = useState<
    Record<
      string,
      {
        rank: number;
        chunk_id?: string;
        quote_text?: string;
        file_name?: string;
        score?: number | null;
      }[]
    >
  >({});

  const filteredResults = usedResults === null ? results : usedResults;
  const usageText = usage ? `tokens: ${usage.total_tokens ?? "-"}` : undefined;
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

  const fetchSourceCount = async () => {
    try {
      const res = await fetch(`${API_BASE}/files`);
      if (!res.ok) return;
      const data = await res.json();
      setSourceCount((data.files || []).length);
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
        {
          rank: number;
          chunk_id?: string;
          quote_text?: string;
          file_name?: string;
          score?: number | null;
        }[]
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
        setWarning("Conversation history is being compressed.");
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
        setWarning("Conversation history is being compressed.");
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
    setIsSourcePanelOpen(true);
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
    setIsSourcePanelOpen(true);
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
      throw new Error(error.detail || "Failed to create chat.");
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
        prev.map((item) => (item.id === chatId ? { ...item, title } : item)),
      );
    } catch {
      // ignore
    }
  };

  const deleteChat = async (chatId: string) => {
    if (!window.confirm("Delete this chat? This action cannot be undone.")) {
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
    fetchSourceCount();
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
    setSearchPhase("idle");
    setSelectedSourceId(null);
    // setSourceItems([]);

    const nextQuery = query.trim();
    if (!nextQuery) {
      setSearchError("Please enter a search query.");
      return;
    }

    let chatId = activeChatId;
    if (activeChatId === "new") {
      try {
        chatId = await createChat();
        setActiveChatId(chatId);
      } catch (err) {
        if (err instanceof Error) {
          setSearchError(err.message || "Failed to create chat.");
        } else {
          setSearchError("Failed to create chat.");
        }
        return;
      }
    }

    setQuery("");
    setSearching(true);
    setSearchPhase("retrieving");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextQuery, chat_id: chatId }),
      });

      if (!res.ok || !res.body) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Search failed.");
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
            setSearchPhase("retrieving");
          } else if (eventName === "used_results") {
            setUsedResults(payload.results || []);
            setSearchPhase("reasoning");
            const indices = payload.indices || [];
            const citations = (payload.results || []).map(
              (item: any, idx: number) => ({
                rank: indices[idx] ?? idx + 1,
                chunk_id: item.chunk_id,
                quote_text: item.quote_text,
                file_name: item.file_name,
                score: item.score ?? null,
              }),
            );
            if (citations.length > 0) {
              setCitationsByMessageId((prev) => ({
                ...prev,
                [assistantId]: citations,
              }));
            }
          } else if (eventName === "delta") {
            const content = payload.content || "";
            if (content) {
              setSearchPhase("generating");
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? { ...item, content: `${item.content}${content}` }
                    : item,
                ),
              );
            }
          } else if (eventName === "usage") {
            setUsage(Object.keys(payload).length > 0 ? payload : null);
          } else if (eventName === "error") {
            setSearchError(payload.message || "Search failed.");
          } else if (eventName === "done") {
            setSearchDone(true);
            setSearchPhase("idle");
          }
        }
      }
      fetchChats();
      if (chatId !== "new") {
        refreshChatStats(chatId);
      }
    } catch (err) {
      if (err instanceof Error) {
        setSearchError(err.message || "Search failed.");
      } else {
        setSearchError("Search failed.");
      }
    } finally {
      setSearching(false);
      setSearchPhase("idle");
    }
  };

  const rightPanel = (
    <aside
      className={`order-last flex h-[100vh] min-h-0 flex-col border-l border-slate-200 bg-white transition-transform duration-300 ease-out ${isSourcePanelOpen ? "translate-x-0" : "translate-x-4"
        }`}
      aria-hidden={!isSourcePanelOpen}
    >
      <div className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-600" />
          <div className="text-base font-bold text-slate-900">来源 ({filteredResults.length})</div>
        </div>
        <button
          className="app-icon-button h-8 w-8"
          onClick={() => setIsSourcePanelOpen(false)}
          type="button"
          aria-label="关闭来源栏"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">

        {sourceLoading && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            正在加载原文...
          </div>
        )}

        {!sourceLoading && sourceItems.length > 0 && (
          <div className="space-y-3 pt-2">
            {sourceItems.map((item, index) => (
              <div
                key={`${item.id ?? "source"}-${index}`}
                className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700"
              >
                <div className="mb-2 font-semibold text-slate-900">
                  {item.file_name || "Unknown source"}
                </div>
                {isTableText(item.text) ? (
                  <pre className="whitespace-pre-wrap font-mono text-xs">
                    {item.text}
                  </pre>
                ) : (
                  <div className="whitespace-pre-wrap">
                    {(() => {
                      const { title, body } = formatResultText(item.text || "");
                      return (
                        <>
                          {title && (
                            <div className="font-medium text-slate-900">
                              {title}
                            </div>
                          )}
                          {body ? `\n\n${body}` : ""}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <AppShell
      activeSection="chat"
      chatSessions={chatSessions}
      activeChatId={activeChatId}
      rightPanel={rightPanel}
      isRightPanelOpen={isSourcePanelOpen}
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
        <div className="h-screen min-h-0">
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
            searchDone={searchDone}
            searchError={searchError}
            warning={warning}
            searchPhase={searching ? searchPhase : "idle"}
            onCitationClick={(ref, messageId) => {
              if (!ref) return;
              if (!Number.isNaN(Number(ref))) {
                const index = Number(ref);
                const local = messageId
                  ? sourcesByMessageId[messageId]
                  : undefined;
                const source = local?.[index - 1];
                if (source?.chunk_id) {
                  loadSourceByChunkId(source.chunk_id);
                  return;
                }
                const citation = messageId
                  ? citationsByMessageId[messageId]?.find(
                    (item) => item.rank === index,
                  )
                  : undefined;
                if (citation?.chunk_id) {
                  loadSourceByChunkId(citation.chunk_id);
                }
                return;
              }
              loadSourceByChunkId(ref);
            }}
            messages={messages}
            usageText={usageText}
            sourceCount={sourceCount ?? undefined}
            citationsByMessageId={citationsByMessageId}
          />
        </div>
      )}
    </AppShell>
  );
}
