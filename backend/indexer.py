from __future__ import annotations

from pathlib import Path
from typing import Iterable

import chromadb
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from llama_index.readers.file import DocxReader, PDFReader
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


def load_documents(file_path: Path, metadata: dict) -> list:
    file_extractor = {
        ".pdf": PDFReader(),
        ".docx": DocxReader(),
    }

    reader = SimpleDirectoryReader(
        input_files=[str(file_path)],
        file_extractor=file_extractor,
        filename_as_id=True,
    )

    docs = reader.load_data()
    for doc in docs:
        doc.metadata.update(metadata)
    return docs


def build_nodes(docs: Iterable, chunk_size: int = 512, chunk_overlap: int = 80) -> list:
    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        include_metadata=True,
        include_prev_next_rel=True,
    )
    return splitter.get_nodes_from_documents(list(docs))


def insert_nodes(index: VectorStoreIndex, nodes: Iterable) -> None:
    index.insert_nodes(list(nodes))
