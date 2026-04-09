from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple
try:
    import camelot
except Exception:
    camelot = None

import chromadb
import mammoth
import re
from bs4 import BeautifulSoup
from llama_index.core import Document, SimpleDirectoryReader, VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import IndexNode, NodeRelationship, RelatedNodeInfo, TextNode
from llama_index.readers.file import PyMuPDFReader
from llama_index.vector_stores.chroma import ChromaVectorStore

from .settings import CHROMA_DIR

_COLLECTION_NAME = "knowledge_base"
_index: VectorStoreIndex | None = None

_PARENT_ID_PREFIX = "parent::"

# Embedding window-aligned chunking defaults.
DEFAULT_CHILD_CHUNK_SIZE = 450
DEFAULT_CHILD_CHUNK_OVERLAP = 80

# Production-friendly embedding text shaping:
# - Only inject `section_title` into embeddings (exclude other metadata keys)
# - Format embedding text as: "章节标题: <section_title>\n内容: <chunk>"
EMBED_METADATA_TEMPLATE = "{value}"
EMBED_TEXT_TEMPLATE = "章节标题: {metadata_str}\n内容: {content}"

# Keys that should never participate in embedding text (operational/structural fields).
# We still allow `section_title` to be embedded.
NON_SEMANTIC_EMBED_METADATA_KEYS: set[str] = {
    "stored_path",
    "_node_type",
    "section_index",
    "section_level",
    "order_idx",
    "file_id",
    "file_name",
    "filename",
    "document_id",
    "parent_id",
    "is_parent",
    "table",
    "table_index",
    "excluded_embed_metadata_keys",
    "excluded_llm_metadata_keys",
    "relationships",
}


def _get_doc_text(doc: object) -> str:
    if hasattr(doc, "get_content"):
        try:
            return str(getattr(doc, "get_content")())
        except Exception:
            pass
    value = getattr(doc, "text", None)
    return str(value) if value is not None else str(doc)


def _ensure_section_title(metadata: dict) -> str:
    title = (metadata or {}).get("section_title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    fallback = (metadata or {}).get("file_name") or (metadata or {}).get("filename") or "Untitled"
    title = str(fallback).strip() if fallback is not None else "Untitled"
    metadata["section_title"] = title
    return title


def _excluded_embed_metadata_keys(metadata: dict, keep: set[str]) -> list[str]:
    keys = set((metadata or {}).keys())
    excluded = (keys - set(keep)) | NON_SEMANTIC_EMBED_METADATA_KEYS
    # Never exclude keys that must be embedded.
    excluded.discard("section_title")
    return sorted(excluded)


def _build_vector_store() -> ChromaVectorStore:
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection = client.get_or_create_collection(_COLLECTION_NAME)
    return ChromaVectorStore(chroma_collection=collection)


def clear_vector_store() -> None:
    global _index
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    try:
        client.delete_collection(_COLLECTION_NAME)
    except Exception:
        pass
    client.get_or_create_collection(_COLLECTION_NAME)
    _index = None


def get_index() -> VectorStoreIndex:
    global _index
    if _index is not None:
        return _index

    vector_store = _build_vector_store()
    _index = VectorStoreIndex.from_vector_store(vector_store=vector_store)
    return _index


def _extract_pdf_tables(file_path: Path) -> list[str]:
    if camelot is None:
        return []
    try:
        tables = camelot.read_pdf(str(file_path), pages="all", flavor="lattice")
    except Exception:
        try:
            tables = camelot.read_pdf(str(file_path), pages="all", flavor="stream")
        except Exception:
            return []

    markdown_tables: list[str] = []
    for i, table in enumerate(tables):
        df = table.df
        if df is None or df.empty:
            continue
        md = df.to_markdown(index=False)
        markdown_tables.append(f"表格 {i + 1}:\n{md}")
    return markdown_tables


def _docx_to_html(file_path: Path) -> str:
    with file_path.open("rb") as docx_file:
        result = mammoth.convert_to_html(docx_file)
    html = result.value or ""
    return html.strip()


def _split_html_by_headings(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    body = soup.body or soup
    sections: list[dict] = []
    current = {"title": "Untitled", "level": 0, "chunks": []}
    heading_stack: list[dict] = []

    def get_logic_level(title: str, level: int) -> float:
        """
        Get logical heading level.

        - If title matches ordinal chapter/section headings like "第一章"/"第十一章"/"第一节",
          keep its original level.
        - Otherwise, return level + 0.5 to make it logically nested under the last
          ordinal heading at the same HTML level.
        """
        value = (title or "").strip()
        if not value:
            return float(level)

        # Match:
        # - Chinese numerals or Arabic digits after "第"
        # - Ends with "章"/"节"
        # - Allows optional trailing title text, e.g. "第一章 总则", "第二十一节 企业文化"
        if re.match(r"^第(?:[一二三四五六七八九十百零〇两]+|\d+)[章节](?:\s*.*)?$", value):
            return float(level)
        return float(level) + 0.5

    def _is_quoted_heading(text: str) -> bool:
        value = (text or "").strip()
        if not value:
            return False
        if "——" in value:
            return True
        quote_marks = {
            "“",
            "”",
            "‘",
            "’",
            '"',
            "'",
            "「",
            "」",
            "『",
            "』",
            "《",
            "》",
        }
        return any(ch in value for ch in quote_marks)

    def _push_heading(level: float, title: str) -> str:
        nonlocal heading_stack
        # Pop until parent level.
        while heading_stack and float(heading_stack[-1]["level"]) >= float(level):
            heading_stack.pop()
        heading_stack.append({"level": level, "title": title})
        return " > ".join(item["title"] for item in heading_stack if item.get("title"))

    for el in body.children:
        if not getattr(el, "name", None):
            continue
        name = el.name.lower()
        if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            level = int(name[1])
            title = el.get_text(" ", strip=True) or "Untitled"
            # Heuristic: if a heading contains quote marks (e.g. “xxx”), it's usually a
            # quoted sentence/citation rather than a real section title. In that case,
            # keep the previous valid heading and treat this as normal content.
            if _is_quoted_heading(title):
                current["chunks"].append(title)
                continue
            if current["chunks"]:
                sections.append(current)
            logic_level = get_logic_level(title, level)
            path_title = _push_heading(logic_level, title)
            current = {
                "title": path_title,
                "leaf_title": title,
                "level": logic_level,
                "chunks": [],
            }
            continue

        text = el.get_text(" ", strip=True)
        if text:
            current["chunks"].append(text)

    if current["chunks"]:
        sections.append(current)

    return sections


def load_documents(file_path: Path, metadata: dict) -> list:
    if file_path.suffix.lower() == ".docx":
        html_text = _docx_to_html(file_path)
        sections = _split_html_by_headings(html_text) if html_text else []
        docs = []
        for idx, sec in enumerate(sections):
            text = f"{sec['title']}\n{'\n'.join(sec['chunks'])}".strip()
            if not text:
                continue
            docs.append(
                Document(
                    text=text,
                    metadata={
                        **metadata,
                        "section_title": sec["title"],
                        "section_leaf_title": sec.get("leaf_title") or sec["title"],
                        "section_level": sec["level"],
                        "section_index": idx,
                    },
                )
            )
    else:
        file_extractor = {
            ".pdf": PyMuPDFReader(),
        }
        reader = SimpleDirectoryReader(
            input_files=[str(file_path)],
            file_extractor=file_extractor,
            filename_as_id=True,
        )
        docs = reader.load_data()

    if file_path.suffix.lower() == ".pdf":
        table_texts = _extract_pdf_tables(file_path)
        if table_texts:
            for idx, text in enumerate(table_texts, start=1):
                extra = Document(text=text, metadata={**metadata, "table": True, "table_index": idx})
                docs.append(extra)
    for doc in docs:
        doc.metadata.update(metadata)
    return docs


def build_nodes(
    docs: Iterable,
    chunk_size: int = DEFAULT_CHILD_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHILD_CHUNK_OVERLAP,
) -> Tuple[list[IndexNode], list[TextNode]]:
    """
    Build nodes for indexing + DB storage.

    - Child chunks are inserted into the vector store as `IndexNode`s. Each IndexNode points
      to its parent section node via `index_id`, and embeds the parent node in `obj` so
      RecursiveRetriever can recover the full section text.
    - Parent section nodes are stored in SQLite (`chunks`) for citation/source preview.

    Returns:
        (index_nodes, db_nodes)
        - index_nodes: IndexNode children for vector indexing
        - db_nodes: TextNode parents + TextNode children for SQLite storage
    """
    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        include_metadata=True,
        include_prev_next_rel=True,
    )

    index_nodes: list[IndexNode] = []
    db_nodes: list[TextNode] = []
    global_order = 0

    for section_idx, doc in enumerate(list(docs)):
        metadata = dict(getattr(doc, "metadata", {}) or {})
        section_title = _ensure_section_title(metadata)
        file_id = metadata.get("file_id") or "unknown"
        parent_id = f"{_PARENT_ID_PREFIX}{file_id}::{section_idx}"
        parent_text = _get_doc_text(doc).strip()
        if not parent_text:
            continue

        parent_node = TextNode(
            id_=parent_id,
            text=parent_text,
            metadata={
                **metadata,
                "section_title": section_title,
                "is_parent": True,
                "section_index": section_idx,
            },
        )
        parent_node.metadata["order_idx"] = None
        db_nodes.append(parent_node)

        # Split *within* the section to avoid "title can't hit全文" and keep retrieval granularity.
        child_docs = [Document(text=parent_text, metadata={**metadata, "section_title": section_title})]
        child_nodes = splitter.get_nodes_from_documents(child_docs)

        child_related: list[RelatedNodeInfo] = []
        for child in child_nodes:
            if not isinstance(child, TextNode):
                child = TextNode(**child.dict())

            child.metadata = dict(child.metadata or {})
            child.metadata.update(
                {
                    **metadata,
                    "section_title": section_title,
                    "section_index": section_idx,
                    "parent_id": parent_id,
                    "is_parent": False,
                    "order_idx": global_order,
                }
            )

            # Ensure section_title participates in embedding text, and avoid polluting embeddings
            # with operational metadata like file_id/stored_path/etc.
            child.metadata_template = EMBED_METADATA_TEMPLATE
            child.text_template = EMBED_TEXT_TEMPLATE
            child.excluded_embed_metadata_keys = _excluded_embed_metadata_keys(
                child.metadata, keep={"section_title"}
            )

            child.relationships[NodeRelationship.PARENT] = RelatedNodeInfo(
                node_id=parent_node.node_id,
                node_type=parent_node.get_type(),
                metadata={"section_title": section_title},
            )
            child_related.append(
                RelatedNodeInfo(
                    node_id=child.node_id,
                    node_type=child.get_type(),
                    metadata={"order_idx": global_order},
                )
            )

            # Vector index stores IndexNode children that can resolve to parent sections.
            idx_node = IndexNode.from_text_node(child, index_id=parent_node.node_id)
            idx_node.obj = parent_node
            index_nodes.append(idx_node)

            # SQLite stores the child chunk as-is (for BM25 + chunk-level preview).
            db_nodes.append(child)

            global_order += 1

        if child_related:
            parent_node.relationships[NodeRelationship.CHILD] = child_related

    return index_nodes, db_nodes


def insert_nodes(index: VectorStoreIndex, nodes: Iterable) -> None:
    index.insert_nodes(list(nodes))


def delete_nodes_by_ids(node_ids: Iterable[str]) -> None:
    ids = list(node_ids)
    if not ids:
        return
    vector_store = _build_vector_store()
    vector_store.delete_nodes(node_ids=ids)
