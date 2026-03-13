"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type TabPanelProps = {
  value: number;
  index: number;
  children: React.ReactNode;
};

type FileItem = {
  id: string;
  filename: string;
  stored_path: string;
  uploaded_at: string;
};

type SearchResult = {
  score: number | null;
  text: string;
  file_name?: string;
  file_id?: string;
  source_path?: string;
};

function TabPanel({ value, index, children }: TabPanelProps) {
  if (value !== index) return null;
  return (
    <Box sx={{ pt: 3 }}>
      {children}
    </Box>
  );
}

export default function Home() {
  const [tab, setTab] = useState(0);
  const [files, setFiles] = useState<FileItem[]>([]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const headerGradient = useMemo(
    () =>
      "linear-gradient(120deg, rgba(187,75,42,0.15), rgba(29,92,99,0.12) 55%, rgba(255,255,255,0.6))",
    []
  );

  const fetchFiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/files`);
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleUpload = async () => {
    setUploadError(null);
    setUploadStatus(null);

    if (!selectedFile) {
      setUploadError("请先选择文件");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "上传失败");
      }

      const data = await res.json();
      setUploadStatus(`上传成功: ${data.filename}`);
      setSelectedFile(null);
      await fetchFiles();
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

  const handleSearch = async () => {
    setSearchError(null);
    setResults([]);

    if (!query.trim()) {
      setSearchError("请输入检索词");
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, top_k: 5 }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "检索失败");
      }

      const data = await res.json();
      setResults(data.results || []);
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

  return (
    <main>
      <Container maxWidth="lg">
        <Paper elevation={0} sx={{ p: 4, background: headerGradient, borderRadius: 4, boxShadow: "var(--shadow)" }}>
          <Stack spacing={1.5}>
            <Typography variant="h4">企业知识库</Typography>
            <Typography color="text.secondary">
              上传企业文档并进行语义检索，系统自动标注来源文件。
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label="DeepSeek" color="primary" />
              <Chip label="Chroma" color="secondary" />
              <Chip label="LlamaIndex" variant="outlined" />
              <Chip label="LangGraph" variant="outlined" />
              <Chip label="Next.js + MUI" variant="outlined" />
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ mt: 4, p: 3, borderRadius: 4, boxShadow: "var(--shadow)" }}>
          <Tabs value={tab} onChange={(_, value) => setTab(value)} textColor="primary">
            <Tab label="文档上传" />
            <Tab label="知识检索" />
          </Tabs>
          <Divider sx={{ mt: 1 }} />

          <TabPanel value={tab} index={0}>
            <Stack spacing={2.5}>
              <Typography variant="h6">上传文档</Typography>
              <Typography color="text.secondary">
                支持 PDF / Word / PPT，上传后自动解析并写入向量数据库。
              </Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                <Button variant="outlined" component="label">
                  选择文件
                  <input
                    type="file"
                    hidden
                    accept=".pdf,.docx,.pptx"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                  />
                </Button>
                <Typography color="text.secondary">
                  {selectedFile ? selectedFile.name : "未选择文件"}
                </Typography>
                <Button variant="contained" onClick={handleUpload} disabled={uploading}>
                  {uploading ? "上传中..." : "开始上传"}
                </Button>
              </Stack>

              {uploadStatus && <Alert severity="success">{uploadStatus}</Alert>}
              {uploadError && <Alert severity="error">{uploadError}</Alert>}

              <Divider />
              <Typography variant="h6">已入库文件</Typography>
              <Stack spacing={1}>
                {files.length === 0 && (
                  <Typography color="text.secondary">暂无文件，请先上传。</Typography>
                )}
                {files.map((file) => (
                  <Paper key={file.id} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography>{file.filename}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {file.uploaded_at}
                        </Typography>
                      </Box>
                      <Chip label={file.id.slice(0, 8)} size="small" />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </TabPanel>

          <TabPanel value={tab} index={1}>
            <Stack spacing={2.5}>
              <Typography variant="h6">知识检索</Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                <TextField
                  fullWidth
                  label="输入检索词"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button variant="contained" onClick={handleSearch} disabled={searching}>
                  {searching ? "检索中..." : "开始检索"}
                </Button>
              </Stack>

              {searchError && <Alert severity="error">{searchError}</Alert>}

              <Stack spacing={2}>
                {results.length === 0 && !searching && !searchError && (
                  <Typography color="text.secondary">输入关键词开始检索。</Typography>
                )}
                {results.map((item, index) => (
                  <Paper key={`${item.file_id ?? "unknown"}-${index}`} variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
                    <Stack spacing={1.2}>
                      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
                          {item.file_name || "未知来源"}
                        </Typography>
                        {item.score !== null && (
                          <Chip label={`Score ${item.score.toFixed(4)}`} size="small" />
                        )}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {item.text}
                      </Typography>
                      {item.source_path && (
                        <Typography variant="caption" color="text.secondary">
                          来源文件: {item.source_path}
                        </Typography>
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </TabPanel>
        </Paper>
      </Container>
    </main>
  );
}
