"""Deterministic text chunking for embedding (§9.5, B5a-3)."""

from __future__ import annotations

import re
from dataclasses import dataclass

_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
_SENTENCE_END = re.compile(r"(?<=[。！？!?；;\.])\s*")


@dataclass(frozen=True, slots=True)
class TextChunk:
    """One chunk with its character offsets inside the source text."""

    index: int
    text: str
    start: int
    end: int


def _split_paragraphs(text: str) -> list[tuple[int, str]]:
    """Split on blank lines, keeping offsets so chunks can be traced back."""
    parts: list[tuple[int, str]] = []
    position = 0
    for match in _PARAGRAPH_SPLIT.finditer(text):
        segment = text[position : match.start()]
        if segment.strip():
            parts.append((position, segment))
        position = match.end()
    tail = text[position:]
    if tail.strip():
        parts.append((position, tail))
    return parts


def _split_long(segment: str, limit: int) -> list[str]:
    """Split an oversized paragraph on sentence boundaries, then hard-cut."""
    pieces: list[str] = []
    for sentence in _SENTENCE_END.split(segment):
        if not sentence:
            continue
        while len(sentence) > limit:
            pieces.append(sentence[:limit])
            sentence = sentence[limit:]
        if sentence:
            pieces.append(sentence)
    return pieces


def chunk_text(
    text: str,
    *,
    chunk_chars: int = 800,
    overlap_chars: int = 100,
    max_chunks: int = 400,
) -> list[TextChunk]:
    """Split text into overlapping chunks, preferring paragraph boundaries.

    The result is deterministic: same input and parameters always yield the same
    chunks, which keeps content hashes and incremental reindexing stable.
    """
    if chunk_chars <= 0:
        raise ValueError("chunk_chars 必须大于 0")
    if overlap_chars < 0 or overlap_chars >= chunk_chars:
        raise ValueError("overlap_chars 必须小于 chunk_chars")
    if not text or not text.strip():
        return []

    pieces: list[str] = []
    for _offset, segment in _split_paragraphs(text):
        if len(segment) <= chunk_chars:
            pieces.append(segment.strip())
        else:
            pieces.extend(
                piece.strip() for piece in _split_long(segment, chunk_chars) if piece.strip()
            )

    chunks: list[TextChunk] = []
    buffer = ""
    buffer_start = 0
    cursor = 0
    for piece in pieces:
        if not piece:
            continue
        if not buffer:
            buffer = piece
            buffer_start = cursor
        elif len(buffer) + 2 + len(piece) <= chunk_chars:
            buffer = f"{buffer}\n\n{piece}"
        else:
            chunks.append(TextChunk(len(chunks), buffer, buffer_start, buffer_start + len(buffer)))
            overlap = buffer[-overlap_chars:] if overlap_chars else ""
            buffer = f"{overlap}{piece}" if overlap else piece
            buffer_start = cursor - len(overlap)
        cursor = buffer_start + len(buffer)
        while len(buffer) > chunk_chars:
            chunks.append(
                TextChunk(
                    len(chunks), buffer[:chunk_chars], buffer_start, buffer_start + chunk_chars
                )
            )
            buffer_start += chunk_chars - overlap_chars
            buffer = buffer[chunk_chars - overlap_chars :]
    if buffer.strip():
        chunks.append(TextChunk(len(chunks), buffer, buffer_start, buffer_start + len(buffer)))
    return chunks[:max_chunks]
