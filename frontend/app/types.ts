export type FileItem = {
  id: string;
  filename: string;
  stored_path: string;
  uploaded_at: string;
};

export type SearchResult = {
  score: number | null;
  text: string;
  file_name?: string;
  file_id?: string;
  source_path?: string;
};

export type UsageInfo = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  context_window?: number;
  remaining_tokens?: number;
};
