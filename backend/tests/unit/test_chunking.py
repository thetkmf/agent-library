"""Chunker behaves deterministically and respects boundaries."""

from __future__ import annotations

from app.services.chunking import chunk_text


def test_empty_content_yields_no_chunks() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_short_text_is_one_chunk() -> None:
    chunks = chunk_text("向量检索的基础知识", chunk_chars=800, overlap_chars=100)
    assert len(chunks) == 1
    assert chunks[0].index == 0
    assert chunks[0].text == "向量检索的基础知识"


def test_paragraphs_are_merged_until_limit() -> None:
    text = "\n\n".join(["第一段" * 20, "第二段" * 20])
    chunks = chunk_text(text, chunk_chars=80, overlap_chars=10)
    assert len(chunks) == 2
    assert chunks[0].text.startswith("第一段")


def test_long_paragraph_is_split_with_overlap() -> None:
    sentence = "这是很长的句子。" * 60
    chunks = chunk_text(sentence, chunk_chars=120, overlap_chars=20)
    assert len(chunks) > 1
    assert all(len(chunk.text) <= 120 for chunk in chunks)
    assert chunks[0].text[-20:] == chunks[1].text[:20]


def test_offsets_are_within_source() -> None:
    text = "段落一。\n\n段落二。" * 20
    chunks = chunk_text(text, chunk_chars=100, overlap_chars=10)
    for chunk in chunks:
        assert 0 <= chunk.start < chunk.end <= len(text)


def test_chunking_is_deterministic() -> None:
    text = "重复内容。\n\n" * 50
    first = chunk_text(text, chunk_chars=100, overlap_chars=10)
    second = chunk_text(text, chunk_chars=100, overlap_chars=10)
    assert [chunk.text for chunk in first] == [chunk.text for chunk in second]


def test_max_chunks_is_enforced() -> None:
    text = "\n\n".join(["段落内容"] * 200)
    chunks = chunk_text(text, chunk_chars=50, overlap_chars=5, max_chunks=3)
    assert len(chunks) == 3


def test_invalid_parameters_raise() -> None:
    import pytest

    with pytest.raises(ValueError):
        chunk_text("x", chunk_chars=0)
    with pytest.raises(ValueError):
        chunk_text("x", chunk_chars=10, overlap_chars=10)
