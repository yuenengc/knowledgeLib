"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FileItem, UploadQueueItem } from "../types";
import AppShell from "../components/AppShell";
import UploadTab from "../components/UploadTab";

const API_BASE = process.env.NEXT_PUBLIC_KNOWLEDGE_LIB_API_BASE || "http://localhost:8000";

type ChatSession = {
  id: string;
  title: string;
};

type UploadTask = {
  task_id: string;
  status: "pending" | "parsing" | "chunking" | "embedding" | "storing" | "completed" | "failed";
  progress: number;
  filename: string;
  error: string | null;
};

export default function UploadPageClient() {
  const searchParams = useSearchParams();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "processing" | "done">("idle");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearStatus, setClearStatus] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState("new");

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

  const updateUploadQueueItem = (id: string, patch: Partial<UploadQueueItem>) => {
    setUploadQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const pollUploadTask = async (taskId: string, queueItemId: string) => {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const res = await fetch(`${API_BASE}/task/${taskId}`, { cache: "no-store" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Task status query failed.");
      }

      const task = (await res.json()) as UploadTask;
      setUploadPhase("processing");
      setUploadStatus(`${task.filename}: ${task.status} ${task.progress}%`);
      updateUploadQueueItem(queueItemId, {
        filename: task.filename,
        status: "processing",
        progress: task.progress,
        message: task.status,
        error: null,
      });

      if (task.status === "completed") {
        setUploadPhase("done");
        setUploadStatus(`${task.filename}: completed`);
        updateUploadQueueItem(queueItemId, {
          status: "completed",
          progress: 100,
          message: "上传完成",
          error: null,
        });
        await fetchFiles();
        return;
      }

      if (task.status === "failed") {
        await fetchFiles();
        updateUploadQueueItem(queueItemId, {
          status: "failed",
          message: "上传失败",
          error: task.error || "Upload processing failed.",
        });
        throw new Error(task.error || "Upload processing failed.");
      }
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchChats();
  }, []);

  useEffect(() => {
    const chatId = searchParams.get("chat");
    if (chatId) {
      setActiveChatId(chatId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeFileId && files.length > 0) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId]);

  const handleUpload = async () => {
    setUploadError(null);
    setUploadStatus(null);
    setUploadPhase("idle");
    setClearStatus(null);
    setClearError(null);
    setDeleteStatus(null);
    setDeleteError(null);

    if (selectedFiles.length === 0) {
      setUploadError("请先选择文件");
      return;
    }

    setUploading(true);
    const queueItems = selectedFiles.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
      filename: file.name,
      progress: 0,
      status: "pending" as const,
      message: "等待上传",
      error: null,
    }));
    setUploadQueue(queueItems);

    let failedCount = 0;
    try {
      for (const [index, file] of selectedFiles.entries()) {
        const queueItem = queueItems[index];
        updateUploadQueueItem(queueItem.id, {
          status: "uploading",
          progress: 0,
          message: "上传中",
          error: null,
        });

        try {
          const formData = new FormData();
          formData.append("file", file);

          const res = await fetch(`${API_BASE}/upload`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || "上传失败");
          }

          const data = await res.json();
          setUploadPhase("processing");
          setUploadStatus(`${data.filename}: queued`);
          updateUploadQueueItem(queueItem.id, {
            filename: data.filename || file.name,
            status: "processing",
            progress: 0,
            message: "后台处理中",
            error: null,
          });
          await fetchFiles();
          await pollUploadTask(data.task_id, queueItem.id);
        } catch (err) {
          failedCount += 1;
          const message = err instanceof Error ? err.message : "上传失败";
          updateUploadQueueItem(queueItem.id, {
            status: "failed",
            message: "上传失败",
            error: message,
          });
        }
      }

      setSelectedFiles([]);
      await fetchFiles();
      if (failedCount > 0) {
        setUploadPhase("done");
        setUploadError(`上传完成，${failedCount} 个文件失败`);
      } else {
        setUploadPhase("done");
        setUploadStatus(`已完成 ${selectedFiles.length} 个文件上传`);
      }
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

  const handleDeleteFile = async (fileId: string) => {
    setDeleteError(null);
    setDeleteStatus(null);
    setUploadStatus(null);
    setUploadError(null);
    setClearStatus(null);
    setClearError(null);

    const target = files.find((file) => file.id === fileId);
    if (!window.confirm(`确定要删除 ${target?.filename ?? "该文件"} 吗？`)) {
      return;
    }

    setDeletingFileId(fileId);
    try {
      const res = await fetch(`${API_BASE}/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "删除失败");
      }
      const data = await res.json();
      setDeleteStatus(`已删除 ${data.filename ?? target?.filename ?? "文件"}`);
      if (activeFileId === fileId) {
        setActiveFileId(null);
      }
      await fetchFiles();
    } catch (err) {
      if (err instanceof Error) {
        setDeleteError(err.message || "删除失败");
      } else {
        setDeleteError("删除失败");
      }
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleClearAll = async () => {
    setClearError(null);
    setClearStatus(null);
    setDeleteStatus(null);
    setDeleteError(null);

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
      const res = await fetch(`${API_BASE}/chats/${chatId}`, { method: "DELETE" });
      if (!res.ok) return;
      setChatSessions((prev) => prev.filter((item) => item.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId("new");
      }
    } catch {
      // ignore
    }
  };

  return (
    <AppShell
      activeSection="upload"
      chatSessions={chatSessions}
      activeChatId={activeChatId}
      onNewChat={() => setActiveChatId("new")}
      onSelectChat={(chatId) => setActiveChatId(chatId)}
      onRenameChat={renameChat}
      onDeleteChat={deleteChat}
    >
      {() => (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="mb-4 text-sm font-semibold text-slate-900">文件上传与历史</div>
          <UploadTab
            selectedFiles={selectedFiles}
            onFilesChange={setSelectedFiles}
            onUpload={handleUpload}
            uploading={uploading}
            uploadPhase={uploadPhase}
            uploadStatus={uploadStatus}
            uploadError={uploadError}
            uploadQueue={uploadQueue}
            files={files}
            onClearAll={handleClearAll}
            clearing={clearing}
            clearStatus={clearStatus}
            clearError={clearError}
            activeFileId={activeFileId}
            onActiveFileChange={setActiveFileId}
            onDeleteFile={handleDeleteFile}
            deletingFileId={deletingFileId}
            deleteStatus={deleteStatus}
            deleteError={deleteError}
          />
        </div>
      )}
    </AppShell>
  );
}
