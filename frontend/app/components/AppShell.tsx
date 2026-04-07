"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  PencilLine,
  Trash2,
  Upload,
  UserCircle,
} from "lucide-react";

type ChatSession = {
  id: string;
  title: string;
};

type AppShellProps = {
  activeSection: "chat" | "upload";
  chatSessions: ChatSession[];
  activeChatId: string;
  children: (ctx: { activeChatTitle: string; activeChatId: string }) => ReactNode;
  rightPanel?: ReactNode;
  onNewChat?: () => void;
  onSelectChat?: (id: string) => void;
  onRenameChat?: (id: string, title: string) => void;
  onDeleteChat?: (id: string) => void;
};

export default function AppShell({
  activeSection,
  chatSessions,
  activeChatId,
  children,
  rightPanel,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
}: AppShellProps) {
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [kbOpen, setKbOpen] = useState(true);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [chatTitleDraft, setChatTitleDraft] = useState("");
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const menuId = menuChatId ? `chat-menu-${menuChatId}` : null;

  const activeChatTitle = useMemo(() => {
    if (activeChatId === "new") return "新对话";
    return chatSessions.find((item) => item.id === activeChatId)?.title || "对话";
  }, [activeChatId, chatSessions]);

  const handleNewChat = () => {
    onNewChat?.();
    router.push("/");
  };

  const handleSelectChat = (session: ChatSession) => {
    onSelectChat?.(session.id);
    router.push(`/?chat=${session.id}`);
  };

  const handleUploadNav = () => {
    router.push("/upload");
  };

  const startEditChatTitle = (session: ChatSession) => {
    setEditingChatId(session.id);
    setChatTitleDraft(session.title);
  };

  const saveChatTitle = (sessionId: string) => {
    const nextTitle = chatTitleDraft.trim();
    if (!nextTitle) return;
    onRenameChat?.(sessionId, nextTitle);
    setEditingChatId(null);
  };

  const handleDeleteChat = (sessionId: string) => {
    onDeleteChat?.(sessionId);
    setMenuChatId(null);
  };

  useEffect(() => {
    if (!menuChatId) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (menuId && target.closest(`#${menuId}`)) return;
      if (target.closest("[data-chat-menu-trigger='true']")) return;
      setMenuChatId(null);
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, [menuChatId, menuId]);

  return (
    <main className="min-h-screen">
      <div className="flex min-h-screen">
        <aside
          className={`flex flex-col border-r border-slate-200/70 bg-[#e9eef6] transition-all duration-300 ${
            isSidebarOpen ? "w-80" : "w-20"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-4">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-white/70 hover:text-slate-900"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              type="button"
              aria-label={isSidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            >
              <Menu className="h-5 w-5" />
            </button>
            {isSidebarOpen && (
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Knowledge Base
              </div>
            )}
          </div>

          <div className="px-4">
            <button
              className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-[24px] bg-slate-900 px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 ${
                isSidebarOpen ? "" : "px-0"
              }`}
              onClick={handleNewChat}
              type="button"
            >
              <MessageSquarePlus className="h-5 w-5" />
              {isSidebarOpen && "发起新对话"}
            </button>
          </div>

          {isSidebarOpen ? (
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 pt-6">
              <div className="space-y-3">
                <button
                  className="flex h-10 w-full items-center justify-between rounded-[24px] bg-[#e9eef6] px-3 text-xs font-semibold text-slate-700 transition hover:bg-white/70"
                  type="button"
                  onClick={() => setKbOpen((prev) => !prev)}
                >
                  <span>知识库管理</span>
                  {kbOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {kbOpen && (
                  <button
                    className={`flex h-10 w-full items-center justify-between rounded-[24px] px-3 text-xs transition ${
                      activeSection === "upload"
                        ? "bg-[#D3E3FD] font-semibold text-slate-900"
                        : "bg-[#e9eef6] text-slate-700 hover:bg-white/80"
                    }`}
                    onClick={handleUploadNav}
                    type="button"
                  >
                    <span>文件上传</span>
                    <Upload className="h-4 w-4" />
                  </button>
                )}
              </div>

              {chatSessions.length > 0 && (
                <div className="space-y-3">
                  <div className="px-3 text-[12px] font-semibold uppercase tracking-wide text-[#334155]">
                    对话
                  </div>
                  <div className="space-y-2">
                    {chatSessions.map((session) => {
                      const isActive = activeChatId === session.id;
                      const isEditing = editingChatId === session.id;
                      return (
                      <div
                        key={session.id}
                        className={`flex h-10 items-center justify-between rounded-[24px] px-3 text-xs transition ${
                          isActive
                            ? "bg-[#D3E3FD] font-semibold text-slate-900"
                            : "bg-[#e9eef6] text-slate-700 hover:bg-white/80"
                        }`}
                      >
                          {isEditing ? (
                            <input
                              className="w-full bg-transparent text-xs outline-none"
                              value={chatTitleDraft}
                              onChange={(event) => setChatTitleDraft(event.target.value)}
                              onBlur={() => saveChatTitle(session.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveChatTitle(session.id);
                                }
                              }}
                              autoFocus
                            />
                          ) : (
                            <button
                              className="flex-1 truncate text-left"
                              type="button"
                              onClick={() => handleSelectChat(session)}
                            >
                              {session.title}
                            </button>
                          )}
                        <div className="relative flex items-center gap-1">
                          {isEditing ? (
                            <button
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-slate-700"
                              onClick={() => saveChatTitle(session.id)}
                              type="button"
                              aria-label="保存标题"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          ) : (
                            <>
                              <button
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition ${
                                  isActive ? "text-slate-700" : "text-slate-400 hover:text-slate-700"
                                }`}
                                data-chat-menu-trigger="true"
                                onClick={() =>
                                  setMenuChatId((prev) => (prev === session.id ? null : session.id))
                                }
                                type="button"
                                aria-label="更多操作"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                              {menuChatId === session.id && (
                                <div
                                  id={menuId ?? undefined}
                                  className="absolute right-0 top-7 z-20 w-28 rounded-lg border border-slate-200 bg-white p-1 text-[11px] shadow-lg"
                                >
                                  <button
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
                                    type="button"
                                    onClick={() => {
                                      setMenuChatId(null);
                                      startEditChatTitle(session);
                                    }}
                                  >
                                    <PencilLine className="h-3 w-3" />
                                    重命名
                                  </button>
                                  <button
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                                    type="button"
                                    onClick={() => handleDeleteChat(session.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    删除
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center gap-3 px-2 py-6">
              <button
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition ${
                  activeSection === "upload"
                    ? "bg-[#D3E3FD] text-slate-900"
                    : "bg-white text-slate-500 hover:bg-white/80"
                }`}
                onClick={handleUploadNav}
                type="button"
                aria-label="文件上传"
              >
                <Upload className="h-4 w-4" />
              </button>
              {chatSessions.length > 0 && (
                <>
                  <div className="h-px w-10 bg-slate-200/70" />
                  {chatSessions.map((session) => (
                    <button
                      key={session.id}
                      className={`h-2.5 w-2.5 rounded-full transition ${
                        activeChatId === session.id ? "bg-slate-900" : "bg-slate-300"
                      }`}
                      onClick={() => handleSelectChat(session)}
                      type="button"
                      aria-label={session.title}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </aside>

        <div className="flex min-h-screen flex-1 flex-col bg-white">
          <header className="flex items-center justify-between px-6 py-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Enterprise Knowledge Base</div>
              <div className="text-xs text-slate-500">语义检索驱动的对话式工作区</div>
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
          </header>

          <div className="flex-1 px-6 pb-8 min-h-0">
            <div className={`grid gap-6 min-h-0 ${rightPanel ? "xl:grid-cols-[1fr_320px]" : ""}`}>
              <div className="min-h-0">
                {children({ activeChatTitle, activeChatId })}
              </div>
                {rightPanel}
              </div>
          </div>
        </div>
      </div>
    </main>
  );
}
