import { FileText, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { FileItem, UploadQueueItem } from "../types";

const ACCEPTED_UPLOAD_EXTENSIONS = [".pdf", ".docx"];
const ACCEPTED_UPLOAD_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

type UploadTabProps = {
  selectedFiles: File[];
  onFilesChange: (files: File[]) => void;
  onUpload: () => void;
  uploading: boolean;
  uploadPhase: "idle" | "processing" | "done";
  uploadStatus: string | null;
  uploadError: string | null;
  uploadQueue: UploadQueueItem[];
  files: FileItem[];
  onClearAll: () => void;
  clearing: boolean;
  clearStatus: string | null;
  clearError: string | null;
  activeFileId: string | null;
  onActiveFileChange: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  deletingFileId: string | null;
  deleteStatus: string | null;
  deleteError: string | null;
};

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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isAcceptedUploadFile(file: File) {
  const filename = file.name.toLowerCase();
  return (
    ACCEPTED_UPLOAD_EXTENSIONS.some((extension) => filename.endsWith(extension)) ||
    ACCEPTED_UPLOAD_TYPES.includes(file.type)
  );
}

export default function UploadTab({
  selectedFiles,
  onFilesChange,
  onUpload,
  uploading,
  uploadPhase,
  uploadStatus,
  uploadError,
  uploadQueue,
  files,
  onClearAll,
  clearing,
  clearStatus,
  clearError,
  activeFileId,
  onActiveFileChange,
  onDeleteFile,
  deletingFileId,
  deleteStatus,
  deleteError,
}: UploadTabProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFilesSelected = (fileList: FileList | null) => {
    const nextFiles = Array.from(fileList || [])
      .filter(isAcceptedUploadFile)
      .slice(0, 3);
    onFilesChange(nextFiles);
  };

  const renderStatusBadge = (status?: FileItem["status"]) => {
    if (status === "processing") {
      return (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
          处理中
        </span>
      );
    }
    if (status === "error") {
      return (
        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
          失败
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        已完成
      </span>
    );
  };

  const renderQueueStatus = (item: UploadQueueItem) => {
    if (item.status === "completed") return "已完成";
    if (item.status === "failed") return item.error || "失败";
    if (item.status === "uploading") return "上传中";
    if (item.status === "processing") return item.message;
    return "等待上传";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer.files?.length) {
      handleFilesSelected(event.dataTransfer.files);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading) return;
    event.preventDefault();
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading) return;
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading) return;
    event.preventDefault();
    setIsDragging(false);
  };

  const triggerFilePicker = () => {
    if (uploading) return;
    const input = document.getElementById("upload-input") as HTMLInputElement | null;
    input?.click();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-slate-900">文件上传</h3>
      </div>

      <div className="flex flex-col gap-3">
        <div
          className={`flex ${uploading ? 'cursor-not-allowed' : 'cursor-pointer'} flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-7 text-center transition ${isDragging
            ? "border-slate-500 bg-[#F3F6FB]"
            : "border-slate-200 bg-[#F9FAFB] hover:border-slate-300"
            }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onClick={triggerFilePicker}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              triggerFilePicker();
            }
          }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
            <Upload className="h-7 w-7" />
          </div>
          <div className="mt-4 text-[16px] font-semibold text-slate-800">
            点击或者将文件拖拽到此处上传
          </div>
          <div className="mt-2 text-[12px] text-slate-400">
            支持 Word(.docx) / PDF，一次最多 3 个文件
          </div>
          {selectedFiles.length > 0 && (
            <div className="mt-4 w-full max-w-md space-y-2">
              {selectedFiles.map((file) => (
                <div
                  key={`${file.name}-${file.lastModified}-${file.size}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">{file.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{formatFileSize(file.size)}</div>
                  </div>
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                </div>
              ))}
              <button
                className="inline-flex h-8 w-full [width:-webkit-fill-available] items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-[11px] font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpload()
                }}
                disabled={uploading || selectedFiles.length === 0}
              >
                <FileText className="h-3.5 w-3.5" />
                {uploading ? "上传中..." : `开始上传${selectedFiles.length ? ` (${selectedFiles.length})` : ""}`}
              </button>
            </div>
          )}
          <input
            id="upload-input"
            type="file"
            hidden
            multiple
            accept={ACCEPTED_UPLOAD_EXTENSIONS.join(",")}
            onChange={(event) => {
              handleFilesSelected(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

      </div>

      {uploadQueue.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
          <div className="border-b border-slate-200/70 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
            上传队列
          </div>
          <div className="divide-y divide-slate-100">
            {uploadQueue.map((item) => (
              <div key={item.id} className="px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-900">{item.filename}</div>
                    <div
                      className={`mt-1 text-[11px] ${item.status === "failed" ? "text-red-600" : "text-slate-500"
                        }`}
                    >
                      {renderQueueStatus(item)}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] font-medium text-slate-500">{item.progress}%</div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${item.status === "failed"
                      ? "bg-red-500"
                      : item.status === "completed"
                        ? "bg-emerald-500"
                        : "bg-amber-200"
                      }`}
                    style={{ width: `${Math.max(0, Math.min(item.progress, 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {uploadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {uploadError}
        </div>
      )}
      {clearStatus && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {clearStatus}
        </div>
      )}
      {clearError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {clearError}
        </div>
      )}
      {deleteStatus && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {deleteStatus}
        </div>
      )}
      {deleteError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {deleteError}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <div className="text-xs font-semibold text-slate-700">知识库文档</div>
        {files.length > 0 && (
          <button
            className="inline-flex items-center gap-1 text-xs text-red-500"
            onClick={onClearAll}
            disabled={clearing || uploading}
          >
            <Trash2 className="h-4 w-4" />
            {clearing ? "清空中" : "清空"}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
        <div className="grid grid-cols-[1.2fr_0.7fr_0.9fr_40px] gap-2 border-b border-slate-200/70 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
          <div>文件名</div>
          <div>状态</div>
          <div>上传时间</div>
          <div className="text-center">操作</div>
        </div>
        {files.length === 0 && <div className="px-3 py-3 text-xs text-slate-500">暂无文件</div>}
        {files.map((file) => {
          const isActive = activeFileId === file.id;
          const isDeleting = deletingFileId === file.id;
          return (
            <div
              key={file.id}
              className={`grid grid-cols-[1.2fr_0.7fr_0.9fr_40px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 ${isActive ? "bg-slate-50" : "bg-white"
                }`}
            >
              <button
                className="truncate text-left font-medium text-slate-900"
                onClick={() => onActiveFileChange(file.id)}
                type="button"
              >
                {file.filename}
              </button>
              <div>{renderStatusBadge(file.status)}</div>
              <div className="text-[11px] text-slate-500">{formatTimestamp(file.uploaded_at)}</div>
              <button
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-red-500 disabled:cursor-not-allowed"
                onClick={() => onDeleteFile(file.id)}
                type="button"
                disabled={isDeleting}
                aria-label="删除文件"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
