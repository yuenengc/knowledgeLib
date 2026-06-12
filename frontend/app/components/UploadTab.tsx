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
    ACCEPTED_UPLOAD_EXTENSIONS.some((extension) =>
      filename.endsWith(extension),
    ) || ACCEPTED_UPLOAD_TYPES.includes(file.type)
  );
}

export default function UploadTab({
  selectedFiles,
  onFilesChange,
  onUpload,
  uploading,
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
        <span className="inline-flex h-6 items-center rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-medium text-amber-800">
          处理中
        </span>
      );
    }
    if (status === "error") {
      return (
        <span className="inline-flex h-6 items-center rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700">
          失败
        </span>
      );
    }
    return (
      <span className="inline-flex h-6 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700">
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

  const renderProgress = (file: File) => {
    const item = uploadQueue.find((i) => i.filename === file.name);
    if (!item) return null;
    return (
      <div key={item.id} className="py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              className={`mt-1 text-xs ${item.status === "failed" ? "text-red-600" : "text-slate-500"}`}
            >
              {renderQueueStatus(item)} {item.progress}%
            </div>
          </div>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${item.status === "failed"
                ? "bg-red-500"
                : item.status === "completed"
                  ? "bg-emerald-500"
                  : "bg-blue-500"
              }`}
            style={{
              width: `${Math.max(0, Math.min(item.progress, 100))}%`,
            }}
          />
        </div>
      </div>
    );
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
    const input = document.getElementById(
      "upload-input",
    ) as HTMLInputElement | null;
    input?.click();
  };

  const alertClass = (tone: "success" | "error") =>
    tone === "success"
      ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
      : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700";

  const isShowingUploadProgress = uploadQueue.length > 0;
  const progressItems = isShowingUploadProgress
    ? uploadQueue
    : selectedFiles.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
      filename: file.name,
      progress: 0,
      status: "uploading" as const,
      error: null,
      message: "",
    }));

  return (
    <div className="space-y-5">
      <section
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition ${uploading ? "cursor-not-allowed opacity-70" : ""
          } ${isDragging
            ? "border-blue-400 bg-blue-50"
            : "border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
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
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
          <Upload className="h-6 w-6" />
        </div>
        <div className="mt-4 text-base font-semibold text-slate-900">
          点击或拖拽文件上传
        </div>
        <div className="mt-2 text-xs text-slate-500">
          支持 Word(.docx) / PDF，一次最多 3 个文件
        </div>

        {selectedFiles.length > 0 && !isShowingUploadProgress && (
          <div className="mt-5 w-full max-w-lg space-y-2">
            {selectedFiles.map((file) => (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm">
                <div
                  key={`${file.name}-${file.lastModified}-${file.size}`}
                  className="flex items-center justify-between gap-3 "
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {file.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {formatFileSize(file.size)}
                    </div>
                  </div>
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                </div>
                {renderProgress(file)}
              </div>
            ))}
            <button
              className="app-primary-button mt-3 w-full"
              onClick={(event) => {
                event.stopPropagation();
                onUpload();
              }}
              disabled={uploading || selectedFiles.length === 0}
              type="button"
            >
              <FileText className="h-4 w-4" />
              {uploading
                ? "上传中..."
                : `开始上传${selectedFiles.length ? ` (${selectedFiles.length})` : ""}`}
            </button>
          </div>
        )}
        {isShowingUploadProgress && progressItems.length > 0 && (
          <div className="mt-5 w-full max-w-xl space-y-2 text-left">
            {progressItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{item.filename}</div>
                    <div className={`mt-1 text-xs ${item.status === "failed" ? "text-red-600" : "text-slate-500"}`}>
                      {item.status === "completed"
                        ? "已完成"
                        : item.status === "failed"
                          ? item.error || "失败"
                          : item.status === "uploading"
                            ? "上传中"
                            : item.message || "处理中"}
                      <span className="ml-2">{Math.max(0, Math.min(item.progress, 100))}%</span>
                    </div>
                  </div>
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${item.status === "failed"
                        ? "bg-red-500"
                        : item.status === "completed"
                          ? "bg-emerald-500"
                          : "bg-blue-500"
                      }`}
                    style={{ width: `${Math.max(0, Math.min(item.progress, 100))}%` }}
                  />
                </div>
              </div>
            ))}
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
      </section>

      {uploadError && <div className={alertClass("error")}>{uploadError}</div>}
      {clearStatus && (
        <div className={alertClass("success")}>{clearStatus}</div>
      )}
      {clearError && <div className={alertClass("error")}>{clearError}</div>}
      {deleteStatus && (
        <div className={alertClass("success")}>{deleteStatus}</div>
      )}
      {deleteError && <div className={alertClass("error")}>{deleteError}</div>}

      {/* {uploadQueue.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
            上传队列
          </div>
          <div className="divide-y divide-slate-100">
            {uploadQueue.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {item.filename}
                    </div>
                    <div
                      className={`mt-1 text-xs ${item.status === "failed" ? "text-red-600" : "text-slate-500"}`}
                    >
                      {renderQueueStatus(item)} {item.progress}%
                    </div>
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      item.status === "failed"
                        ? "bg-red-500"
                        : item.status === "completed"
                          ? "bg-emerald-500"
                          : "bg-blue-500"
                    }`}
                    style={{
                      width: `${Math.max(0, Math.min(item.progress, 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )} */}

      <div className="flex items-center justify-between pt-1">
        <div>
          <div className="text-sm font-semibold text-slate-900">知识库文档</div>
          <div className="mt-1 text-xs text-slate-500">
            {files.length} 个文件
          </div>
        </div>
        {files.length > 0 && (
          <button
            className="app-secondary-button text-red-600 hover:text-red-700"
            onClick={onClearAll}
            disabled={clearing || uploading}
          >
            <Trash2 className="h-4 w-4" />
            {clearing ? "清空中" : "清空"}
          </button>
        )}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_0.7fr_0.9fr_44px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
          <div>文件名</div>
          <div>状态</div>
          <div>上传时间</div>
          <div className="text-center">操作</div>
        </div>
        {files.length === 0 && (
          <div className="px-4 py-5 text-sm text-slate-500">暂无文件</div>
        )}
        {files.map((file) => {
          const isActive = activeFileId === file.id;
          const isDeleting = deletingFileId === file.id;
          return (
            <div
              key={file.id}
              className={`grid grid-cols-[1.2fr_0.7fr_0.9fr_44px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 ${isActive ? "bg-blue-50/60" : "bg-white"
                }`}
            >
              <button
                className="truncate text-left font-medium text-slate-900 hover:text-blue-700"
                onClick={() => onActiveFileChange(file.id)}
                type="button"
              >
                {file.filename}
              </button>
              <div>{renderStatusBadge(file.status)}</div>
              <div className="text-xs text-slate-500">
                {formatTimestamp(file.uploaded_at)}
              </div>
              {file.status !== "processing" && (
                <button
                  className="app-icon-button h-8 w-8 hover:text-red-600"
                  onClick={() => onDeleteFile(file.id)}
                  type="button"
                  disabled={isDeleting}
                  aria-label="删除文件"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
