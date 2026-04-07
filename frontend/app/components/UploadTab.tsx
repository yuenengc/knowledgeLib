import { FileText, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { FileItem } from "../types";

type UploadTabProps = {
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
  uploading: boolean;
  uploadStatus: string | null;
  uploadError: string | null;
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

export default function UploadTab({
  selectedFile,
  onFileChange,
  onUpload,
  uploading,
  uploadStatus,
  uploadError,
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

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0] || null;
    if (file) {
      onFileChange(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const triggerFilePicker = () => {
    const input = document.getElementById("upload-input") as HTMLInputElement | null;
    input?.click();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-slate-900">文件上传</h3>
        <p className="text-xs text-slate-500">支持 PDF / Word / PPT</p>
      </div>

      <div className="flex flex-col gap-3">
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-7 text-center transition ${
            isDragging
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
            支持 PDF, Docx, Markdown, TXT (单个文件不超过 50MB)
          </div>
          <input
            id="upload-input"
            type="file"
            hidden
            accept=".pdf,.docx,.pptx,.md,.txt"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          />
        </div>

        {selectedFile && (
          <div className="rounded-xl border border-dashed border-slate-200/70 bg-white px-3 py-2 text-[11px] text-slate-500">
            已选择：{selectedFile.name}
          </div>
        )}

        <button
          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-[11px] font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onUpload}
          disabled={uploading}
        >
          <FileText className="h-3.5 w-3.5" />
          {uploading ? "上传中..." : "开始上传"}
        </button>
      </div>

      {uploadStatus && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {uploadStatus}
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
        <div className="text-xs font-semibold text-slate-700">历史文件</div>
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
        <div className="grid grid-cols-[1.2fr_0.9fr_40px] gap-2 border-b border-slate-200/70 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
          <div>文件名</div>
          <div>上传时间</div>
          <div className="text-center">操作</div>
        </div>
        {files.length === 0 && (
          <div className="px-3 py-3 text-xs text-slate-500">暂无文件</div>
        )}
        {files.map((file) => {
          const isActive = activeFileId === file.id;
          const isDeleting = deletingFileId === file.id;
          return (
            <div
              key={file.id}
              className={`grid grid-cols-[1.2fr_0.9fr_40px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 ${
                isActive ? "bg-slate-50" : "bg-white"
              }`}
            >
              <button
                className="truncate text-left font-medium text-slate-900"
                onClick={() => onActiveFileChange(file.id)}
                type="button"
              >
                {file.filename}
              </button>
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
