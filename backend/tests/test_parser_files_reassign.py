"""Test parser_files reassign on draft promotion + save-to-quote.

Verifies the bug fix where parser_files were orphaned when:
  - local tab id (`local-xxx`) → persisted draft id (autosave)
  - draft id → saved quote id (createQuote)
"""
import asyncio
from services.parser_files import (
    save_parser_file, list_parser_files, reassign_quote_files,
    soft_delete_file,
)


def _run(coro):
    return asyncio.run(coro)


def test_reassign_moves_records_from_draft_to_quote():
    async def flow():
        f = await save_parser_file(
            quote_id="local-abc123",
            filename="rfq.pdf",
            mime="application/pdf",
            content=b"%PDF-1.4 test",
            uploaded_by="test@example.com",
            source="upload",
        )
        # found under original
        listed = await list_parser_files("local-abc123")
        assert any(d["id"] == f["id"] for d in listed)

        # local → draft
        n = await reassign_quote_files("local-abc123", "draft-uuid-1")
        assert n >= 1
        assert all(d["id"] != f["id"] for d in await list_parser_files("local-abc123"))
        assert any(d["id"] == f["id"] for d in await list_parser_files("draft-uuid-1"))

        # draft → saved quote
        n2 = await reassign_quote_files("draft-uuid-1", "quote-uuid-9")
        assert n2 >= 1
        assert any(d["id"] == f["id"] for d in await list_parser_files("quote-uuid-9"))

        await soft_delete_file(f["id"])
    _run(flow())


def test_reassign_noop_on_empty_or_same_ids():
    async def flow():
        assert await reassign_quote_files("", "anything") == 0
        assert await reassign_quote_files("anything", "") == 0
        assert await reassign_quote_files("same", "same") == 0
    _run(flow())
