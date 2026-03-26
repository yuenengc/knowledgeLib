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
};

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
}: UploadTabProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">上传文档</h3>
        <p className="text-xs text-slate-500">支持 PDF / Word / PPT</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-200/60 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
          选择文件
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.pptx"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          />
        </label>
        <span className="text-xs text-slate-500">{selectedFile ? selectedFile.name : "未选择文件"}</span>
        <button
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onUpload}
          disabled={uploading}
        >
          {uploading ? "上传中..." : "开始上传"}
        </button>
        {files.length > 0 && (
          <button
            className="rounded-lg px-2 py-2 text-xs text-red-500 hover:text-red-600"
            onClick={onClearAll}
            disabled={clearing || uploading}
          >
            {clearing ? "清空中..." : "清空历史"}
          </button>
        )}
      </div>

      {uploadStatus && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{uploadStatus}</div>}
      {uploadError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{uploadError}</div>}
      {clearStatus && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{clearStatus}</div>}
      {clearError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{clearError}</div>}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-700">已入库文件</h4>
        </div>
        <div className="divide-y divide-slate-200/60 rounded-xl border border-slate-200/60 bg-white">
          {files.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">暂无文件，请先上传。</div>}
          {files.map((file) => (
            <div key={file.id} className="px-3 py-2 text-sm text-slate-700">
              <div className="font-medium text-slate-900">{file.filename}</div>
              <div className="text-xs text-slate-500">{file.uploaded_at}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
