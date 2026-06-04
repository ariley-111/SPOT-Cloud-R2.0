"""RFQ Parser — Anthropic Opus 4.7 multimodal ingestion.

PORTED VERBATIM from legacy spot_server.js anthropicParseRfqBatch (D-136 / D-141 / D-144 / D-145).

Output schema (legacy contract):
  {
    "parsed":     { ...full SPOT intake object... },
    "sources":    { "<fieldPath>": "<TAG>", ... },     // D-136 (R1.6.3) REQUIRED
    "method":     "M1"|"M2"|"M3"|"M4"|"M5",            // D-136 (R1.6.3) REQUIRED
    "asks":       [ {"field": <path>, "reason": <text>} ],
    "confidence": 0.0-1.0
  }

The system prompt is BIG (canonical terms + quoting rules + board library + control
defaults + harness highlights + customer registry). We use Anthropic prompt caching
(cache_control: ephemeral) so the giant prompt is billed once and re-used cheaply
across parses.
"""
from __future__ import annotations
import base64
import json
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from db import db, COL_PARSER_BUDGET, COL_CUSTOMERS
from models.schemas import User
from routes.auth import get_current_user
from parser_knowledge import build_knowledge_prompt, EXTRACTION_INSTRUCTIONS

router = APIRouter(prefix="/api/parser", tags=["parser"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-7")
ANTHROPIC_MONTHLY_CAP_USD = float(os.environ.get("ANTHROPIC_MONTHLY_CAP_USD", "500"))

# ─── Effective key/model lookup ─── DB override > .env (loaded at startup)
from services.integrations import get_effective as _integ_get
from services import parser_usage as _usage


def _effective_anthropic_key() -> str:
    return _integ_get("ANTHROPIC_API_KEY") or ANTHROPIC_API_KEY


def _effective_anthropic_model() -> str:
    return _integ_get("ANTHROPIC_MODEL") or ANTHROPIC_MODEL
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

# D-141 (R1.6.4) — per-call input-token pre-flight against the 450k/min TPM cap.
# 80% threshold = 360,000. Heuristic conservative (D-144): PDFs/images @ bytes/250,
# text @ bytes/4. Refuse before hitting Anthropic if estimated tokens exceed threshold.
TPM_CAP = 450_000
PREFLIGHT_THRESHOLD = int(TPM_CAP * 0.80)

# Pricing per million tokens (USD) — for budget tracking only
MODEL_PRICING = {
    "claude-opus-4-7":   {"input": 15.0, "output": 75.0, "cache_read": 1.50, "cache_write": 18.75},
    "claude-opus-4-6":   {"input": 15.0, "output": 75.0, "cache_read": 1.50, "cache_write": 18.75},
    "claude-sonnet-4-6": {"input": 3.0,  "output": 15.0, "cache_read": 0.30, "cache_write": 3.75},
}


def _current_month() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year}-{now.month:02d}"


async def _get_budget_doc() -> Dict[str, Any]:
    month = _current_month()
    doc = await db[COL_PARSER_BUDGET].find_one({"month": month}, {"_id": 0})
    if doc is None:
        doc = {
            "month": month,
            "spend_usd": 0.0,
            "calls": 0,
            "cap_usd": ANTHROPIC_MONTHLY_CAP_USD,
            "model": ANTHROPIC_MODEL,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db[COL_PARSER_BUDGET].insert_one(doc)
    return doc


async def _record_spend(input_tokens: int, output_tokens: int,
                        cache_read_tokens: int = 0, cache_write_tokens: int = 0,
                        model: Optional[str] = None) -> Dict[str, Any]:
    mdl = model or _effective_anthropic_model()
    pricing = MODEL_PRICING.get(mdl, {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 18.75})
    cost = (
        (input_tokens / 1_000_000) * pricing["input"]
        + (output_tokens / 1_000_000) * pricing["output"]
        + (cache_read_tokens / 1_000_000) * pricing.get("cache_read", 0.0)
        + (cache_write_tokens / 1_000_000) * pricing.get("cache_write", 0.0)
    )
    month = _current_month()
    result = await db[COL_PARSER_BUDGET].find_one_and_update(
        {"month": month},
        {"$inc": {"spend_usd": cost, "calls": 1}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    return {**(result or {"month": month, "spend_usd": cost, "calls": 1}), "_call_cost_usd": cost}


@router.get("/budget")
async def get_budget(_u: User = Depends(get_current_user)) -> Dict[str, Any]:
    doc = await _get_budget_doc()
    return {
        **doc,
        "remaining_usd": max(0, doc.get("cap_usd", ANTHROPIC_MONTHLY_CAP_USD) - doc.get("spend_usd", 0)),
        "model": _effective_anthropic_model(),
    }


async def _load_customer_registry(limit: int = 5000) -> List[Dict[str, str]]:
    """Fetch the full customer list for prompt injection (D-136 REGISTRY tag)."""
    cursor = db[COL_CUSTOMERS].find({}, {"_id": 0, "code": 1, "name": 1}).limit(limit)
    return await cursor.to_list(length=limit)


def _extract_xlsx_text(content: bytes, fname: str) -> str:
    """Dump every cell from every sheet as tab-separated rows so Claude can read RFQ
    spreadsheets (qty tables, BOMs, customer-supplied specs).
    """
    try:
        import io
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), data_only=True)
        out: List[str] = []
        for sname in wb.sheetnames:
            ws = wb[sname]
            out.append(f"---- SHEET: {sname} ----")
            for row in ws.iter_rows(values_only=True):
                vals = ["" if v is None else str(v) for v in row]
                if any(v.strip() for v in vals):
                    out.append("\t".join(vals))
            out.append("")
        return "\n".join(out)
    except Exception as e:
        return f"<unable to read .xlsx: {e}>"


def _extract_docx_text(content: bytes, fname: str) -> str:
    """Pull paragraphs + table cells from a .docx so Claude can read RFQ Word documents."""
    try:
        import io
        from docx import Document
        doc = Document(io.BytesIO(content))
        out: List[str] = []
        for p in doc.paragraphs:
            if p.text.strip():
                out.append(p.text)
        for ti, t in enumerate(doc.tables):
            out.append(f"---- TABLE {ti+1} ----")
            for row in t.rows:
                cells = [c.text.strip() for c in row.cells]
                if any(cells):
                    out.append(" | ".join(cells))
        return "\n".join(out)
    except Exception as e:
        return f"<unable to read .docx: {e}>"


def _estimate_input_tokens(system_text: str, content_parts: List[Dict[str, Any]]) -> int:
    """D-141 conservative pre-flight estimator. Per legacy:
       - PDF / image bytes count at bytes/250 (D-144 calibrated mid-point).
       - Text content at bytes/4.
       - System prompt at chars/4.
    """
    estimate = math.ceil(len(system_text) / 4)
    for part in content_parts:
        ptype = part.get("type")
        if ptype in ("document", "image"):
            src = part.get("source", {}) or {}
            b64 = src.get("data", "") or ""
            # b64 → bytes (approx)
            raw_bytes = int(len(b64) * 0.75)
            estimate += math.ceil(raw_bytes / 250)
        else:
            txt = part.get("text", "") or ""
            estimate += math.ceil(len(txt.encode("utf-8")) / 4)
    return estimate


async def _call_anthropic(content_parts: List[Dict[str, Any]]) -> Dict[str, Any]:
    api_key = _effective_anthropic_key()
    model = _effective_anthropic_model()
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")
    # Budget gate
    budget = await _get_budget_doc()
    if budget.get("spend_usd", 0) >= budget.get("cap_usd", ANTHROPIC_MONTHLY_CAP_USD):
        raise HTTPException(429, f"Monthly Anthropic budget cap reached (${budget['cap_usd']})")

    # Build the system prompt fresh each call so the customer registry is current.
    customer_registry = await _load_customer_registry()
    knowledge_text = build_knowledge_prompt(customer_registry)

    # D-141 pre-flight
    estimated = _estimate_input_tokens(knowledge_text + EXTRACTION_INSTRUCTIONS, content_parts)
    if estimated > PREFLIGHT_THRESHOLD:
        raise HTTPException(
            413,
            f"Input too large: estimated {estimated:,} tokens exceeds pre-flight threshold "
            f"{PREFLIGHT_THRESHOLD:,} (80% of {TPM_CAP:,}/min TPM cap). "
            f"Reduce file count, split into separate parses, or drop non-RFQ files.",
        )

    # Final user instruction is appended to content_parts (the actual extraction directive)
    full_content = list(content_parts) + [{"type": "text", "text": EXTRACTION_INSTRUCTIONS}]

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": model,
        # 16K output tokens — high enough for 40+ component multi-part RFQs.
        # Claude Opus 4.1 supports up to 64K but we cap at 16K to keep per-parse
        # cost predictable. If we hit truncation, we log + raise a clear error.
        "max_tokens": 16384,
        # Stream the response. This keeps the K8s ingress connection warm during
        # long parses (Anthropic emits ping events every ~15s). Without streaming,
        # large RFQs hit the ingress idle-timeout and return 502 even though the
        # upstream call eventually succeeds.
        "stream": True,
        # Prompt caching: the big knowledge prompt is cached (ephemeral 5m TTL); billed once
        # then re-used across parses at ~10x discount. Mirrors legacy line 838.
        "system": [{
            "type": "text",
            "text": knowledge_text,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": full_content}],
    }
    # Reassemble streamed Anthropic events into a single (text, stop_reason, usage)
    # tuple. Server-Sent Events stream: each event is a line "event: ..." then
    # "data: {json}". We only care about content_block_delta (text deltas) and
    # message_delta / message_stop (terminal events with usage + stop_reason).
    import json as _json
    text_chunks: List[str] = []
    stop_reason = None
    usage: Dict[str, Any] = {}
    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("POST", ANTHROPIC_URL, headers=headers, json=body) as resp:
            if resp.status_code >= 400:
                body_text = (await resp.aread()).decode("utf-8", errors="ignore")
                raise HTTPException(resp.status_code, f"Anthropic API: {body_text[:500]}")
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    ev = _json.loads(payload)
                except _json.JSONDecodeError:
                    continue
                etype = ev.get("type")
                if etype == "content_block_delta":
                    d = ev.get("delta") or {}
                    if d.get("type") == "text_delta":
                        text_chunks.append(d.get("text", ""))
                elif etype == "message_delta":
                    d = ev.get("delta") or {}
                    if "stop_reason" in d:
                        stop_reason = d["stop_reason"]
                    u = ev.get("usage") or {}
                    if u:
                        usage.update(u)
                elif etype == "message_start":
                    m = ev.get("message") or {}
                    u = m.get("usage") or {}
                    if u:
                        usage.update(u)
    data = {
        "content": [{"type": "text", "text": "".join(text_chunks)}],
        "stop_reason": stop_reason,
        "usage": usage,
    }

    # Detect truncation up front — happens when an RFQ has so many components
    # that the JSON response exceeds max_tokens. JSON.parse will fail downstream
    # with a confusing error; surfacing this cleanly is more useful.
    stop_reason = data.get("stop_reason")
    if stop_reason == "max_tokens":
        raise HTTPException(
            413,
            "Parser response truncated — this RFQ has too many components for a single parse. "
            "Try splitting the CAD PDF into smaller chunks (e.g. 20 components per file) and "
            "running multiple parses, then merging into one BOM."
        )

    usage = data.get("usage") or {}
    spend = await _record_spend(
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
        usage.get("cache_read_input_tokens", 0),
        usage.get("cache_creation_input_tokens", 0),
        model=model,
    )

    # Concatenate text blocks from response
    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")

    # Try to parse JSON
    text_stripped = text.strip()
    if text_stripped.startswith("```"):
        lines = text_stripped.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text_stripped = "\n".join(lines).strip()

    try:
        result_obj = json.loads(text_stripped)
    except json.JSONDecodeError:
        start = text_stripped.find("{")
        end = text_stripped.rfind("}")
        if start >= 0 and end > start:
            try:
                result_obj = json.loads(text_stripped[start:end + 1])
            except json.JSONDecodeError:
                result_obj = {"_raw": text, "_parse_error": "Could not extract JSON"}
        else:
            result_obj = {"_raw": text, "_parse_error": "No JSON found in response"}

    # Legacy contract: {parsed, sources, method, asks, confidence}
    # Normalise into the new schema, accept old flat schemas too for backwards-compat
    if isinstance(result_obj, dict) and "parsed" in result_obj:
        normalized = {
            "parsed":     result_obj.get("parsed") or {},
            "sources":    result_obj.get("sources") or {},
            "method":     result_obj.get("method") or "M1",
            "asks":       result_obj.get("asks") or [],
            "confidence": result_obj.get("confidence", 0.5),
        }
    else:
        # Older shape: flat parsed object at top level
        flat = result_obj if isinstance(result_obj, dict) else {}
        normalized = {
            "parsed":     {k: v for k, v in flat.items() if k not in ("asks", "confidence", "_source", "sources", "method")},
            "sources":    flat.get("sources") or {},
            "method":     flat.get("method") or "M1",
            "asks":       flat.get("asks") or [],
            "confidence": flat.get("confidence", 0.5),
        }

    # Server-side difficulty enforcement — Claude sometimes returns Standard even
    # when the inches-of-rule exceeds 3× perimeter. Cloud overrides with the iQuote
    # calc result so the result is deterministic. Estimator can still flip manually.
    def _coerce_difficulty(state: Dict[str, Any]) -> None:
        try:
            from engine.core import compute_difficulty_from_rule
            ri = float(state.get("totalRuleInches") or 0)
            uw = float(state.get("oneUpW") or 0)
            ul = float(state.get("oneUpL") or 0)
            if ri > 0 and uw > 0 and ul > 0:
                # Don't overwrite if estimator/parser explicitly chose Simple (edge case).
                if state.get("cadDifficulty") == "Simple":
                    return
                state["cadDifficulty"] = compute_difficulty_from_rule(ri, uw, ul)
        except Exception:
            pass

    parsed_root = normalized.get("parsed") or {}
    _coerce_difficulty(parsed_root)
    for bi in (parsed_root.get("bomItems") or []):
        if isinstance(bi, dict):
            st = bi.get("state")
            if isinstance(st, dict):
                _coerce_difficulty(st)

    return {
        **normalized,
        "model": data.get("model"),
        "usage": usage,
        "stop_reason": data.get("stop_reason"),
        "estimated_input_tokens": estimated,
        "_call_cost_usd": spend.get("_call_cost_usd", 0.0),
        "_resolved_model": model,
    }


@router.post("/parse-rfq")
async def parse_rfq(
    files: List[UploadFile] = File(default=[]),
    email_body: Optional[str] = Form(default=None),
    notes: Optional[str] = Form(default=None),
    customer_code: Optional[str] = Form(default=None),
    customer_name: Optional[str] = Form(default=None),
    est_initials: Optional[str] = Form(default=None),
    u: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Parse one or more RFQ attachments + optional email body into a structured estimate.

    Accepts PDF, PNG, JPEG, WebP, GIF, plain text. Each file becomes a content block;
    email body (if provided) becomes a text block. Output matches the legacy
    {parsed, sources, method, asks, confidence} contract.
    """
    if not files and not email_body and not notes:
        raise HTTPException(400, "Must provide at least one file or email_body")

    content_parts: List[Dict[str, Any]] = []
    file_summary: List[Dict[str, Any]] = []

    if email_body:
        content_parts.append({"type": "text", "text": f"EMAIL BODY:\n\n{email_body}"})
    if notes:
        content_parts.append({"type": "text", "text": f"ESTIMATOR NOTES:\n\n{notes}"})

    # ─── Email file expansion ───────────────────────────────────────
    # If any uploaded file is .eml or .msg, extract body text + attachments and
    # promote them into content_parts. User requested behavior (2026-06-01).
    expanded_files: List[Dict[str, Any]] = []
    for f in files:
        name_lower = (f.filename or "").lower()
        if name_lower.endswith(".eml") or name_lower.endswith(".msg"):
            try:
                from utils.email_extract import extract_email_file
                raw = await f.read()
                ext = extract_email_file(f.filename, raw)
                # Append email body as a text block (subject + from + body)
                body_chunks = []
                if ext.get("subject"): body_chunks.append(f"SUBJECT: {ext['subject']}")
                if ext.get("from"):    body_chunks.append(f"FROM: {ext['from']}")
                if ext.get("body"):    body_chunks.append(ext["body"])
                if body_chunks:
                    content_parts.append({"type": "text",
                        "text": f"EMAIL ({f.filename}):\n\n" + "\n\n".join(body_chunks)})
                # Re-inject each attachment as a synthetic UploadFile-ish dict (we'll
                # process them inline below — simpler than wrapping UploadFile here).
                for att in ext.get("attachments", []):
                    expanded_files.append({
                        "filename": att["filename"], "mime": att["mime"],
                        "content": att["bytes"],
                    })
                file_summary.append({"name": f.filename, "type": "email",
                                     "attachments": len(ext.get("attachments", [])),
                                     "body_chars": len(ext.get("body") or "")})
            except Exception as e:
                file_summary.append({"name": f.filename, "type": "email", "error": str(e)})
            continue
        # Non-email files: read inline (matches original loop)
        content_bytes = await f.read()
        if not content_bytes:
            continue
        expanded_files.append({
            "filename": f.filename, "mime": f.content_type or "application/octet-stream",
            "content": content_bytes,
        })

    for ef in expanded_files:
        content = ef["content"]
        if not content:
            continue
        size = len(content)
        b64 = base64.standard_b64encode(content).decode("utf-8")
        media_type = ef["mime"] or "application/octet-stream"
        fname = ef["filename"]
        if media_type == "application/pdf" or (fname or "").lower().endswith(".pdf"):
            content_parts.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
            })
            file_summary.append({"name": fname, "type": "pdf", "size": size})
        elif media_type.startswith("image/"):
            content_parts.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })
            file_summary.append({"name": fname, "type": "image", "size": size})
        elif (fname or "").lower().endswith((".xlsx", ".xls")):
            # Spreadsheets — extract per-sheet cell values as plain text. Excel is
            # how some customers send RFQ qty/spec tables.
            text = _extract_xlsx_text(content, fname)
            content_parts.append({"type": "text", "text": f"SPREADSHEET ({fname}):\n\n{text[:80000]}"})
            file_summary.append({"name": fname, "type": "xlsx", "size": size})
        elif (fname or "").lower().endswith((".docx",)):
            text = _extract_docx_text(content, fname)
            content_parts.append({"type": "text", "text": f"WORD DOC ({fname}):\n\n{text[:80000]}"})
            file_summary.append({"name": fname, "type": "docx", "size": size})
        elif (fname or "").lower().endswith((".doc", ".rtf")):
            # Legacy binary Word/RTF — pass as best-effort decode. Most modern
            # customers send .docx; if .doc is critical, recommend conversion.
            try:
                text = content.decode("utf-8", errors="replace")
            except Exception:
                text = "<unable to decode .doc — recommend re-sending as .docx or PDF>"
            content_parts.append({"type": "text", "text": f"DOC ({fname}):\n\n{text[:50000]}"})
            file_summary.append({"name": fname, "type": "doc", "size": size})
        elif (fname or "").lower().endswith((".csv", ".tsv", ".txt")):
            try:
                text = content.decode("utf-8", errors="replace")
            except Exception:
                text = "<unable to decode>"
            content_parts.append({"type": "text", "text": f"DATA ({fname}):\n\n{text[:80000]}"})
            file_summary.append({"name": fname, "type": "csv", "size": size})
        else:
            try:
                text = content.decode("utf-8", errors="replace")
            except Exception:
                text = "<binary content>"
            content_parts.append({"type": "text", "text": f"ATTACHMENT ({fname}):\n\n{text[:50000]}"})
            file_summary.append({"name": fname, "type": "text", "size": size})

    # ─── Call Anthropic (with usage logging) ────────────────────────
    try:
        result = await _call_anthropic(content_parts)
        # Log usage row — success path
        u_usage = result.get("usage") or {}
        await _usage.log_parse(
            user_email=u.email,
            est_initials=est_initials,
            customer_code=customer_code,
            customer_name=customer_name,
            model=result.get("_resolved_model") or _effective_anthropic_model(),
            input_tokens=u_usage.get("input_tokens", 0),
            output_tokens=u_usage.get("output_tokens", 0),
            cache_read_tokens=u_usage.get("cache_read_input_tokens", 0),
            cache_write_tokens=u_usage.get("cache_creation_input_tokens", 0),
            cost_usd=float(result.get("_call_cost_usd") or 0),
            file_count=len(file_summary),
            success=True,
        )
    except HTTPException as e:
        # Log usage row — failure path (no cost; record the error for visibility)
        await _usage.log_parse(
            user_email=u.email,
            est_initials=est_initials,
            customer_code=customer_code,
            customer_name=customer_name,
            model=_effective_anthropic_model(),
            input_tokens=0, output_tokens=0,
            cache_read_tokens=0, cache_write_tokens=0,
            cost_usd=0.0,
            file_count=len(file_summary),
            success=False, error=f"{e.status_code}: {e.detail}",
        )
        raise

    # Strip internal-only fields before returning to client
    result.pop("_call_cost_usd", None)
    result.pop("_resolved_model", None)
    return {**result, "files": file_summary}
