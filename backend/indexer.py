from __future__ import annotations

from pathlib import Path
from typing import Iterable

try:
    import camelot
except Exception:
    camelot = None

import chromadb
from llama_index.core import Document, SimpleDirectoryReader, VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from llama_index.readers.file import DocxReader, PyMuPDFReader
from llama_index.vector_stores.chroma import ChromaVectorStore

from .settings import CHROMA_DIR

_COLLECTION_NAME = "knowledge_base"
_index: VectorStoreIndex | None = None


def _build_vector_store() -> ChromaVectorStore:
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection = client.get_or_create_collection(_COLLECTION_NAME)
    return ChromaVectorStore(chroma_collection=collection)


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


def load_documents(file_path: Path, metadata: dict) -> list:
    file_extractor = {
        ".pdf": PyMuPDFReader(),
        ".docx": DocxReader(),
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


def build_nodes(docs: Iterable, chunk_size: int = 2000, chunk_overlap: int = 300) -> list:
    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        include_metadata=True,
        include_prev_next_rel=True,
    )
    nodes = splitter.get_nodes_from_documents(list(docs))
    for idx, node in enumerate(nodes):
        node.metadata["order_idx"] = idx
    return nodes


def insert_nodes(index: VectorStoreIndex, nodes: Iterable) -> None:
    index.insert_nodes(list(nodes))


def delete_nodes_by_ids(node_ids: Iterable[str]) -> None:
    ids = list(node_ids)
    if not ids:
        return
    vector_store = _build_vector_store()
    vector_store.delete_nodes(node_ids=ids)
