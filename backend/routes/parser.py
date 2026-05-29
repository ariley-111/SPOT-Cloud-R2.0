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
                        cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> Dict[str, Any]:
    pricing = MODEL_PRICING.get(ANTHROPIC_MODEL, {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 18.75})
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
    return result or {"month": month, "spend_usd": cost, "calls": 1}


@router.get("/budget")
async def get_budget(_u: User = Depends(get_current_user)) -> Dict[str, Any]:
    doc = await _get_budget_doc()
    return {
        **doc,
        "remaining_usd": max(0, doc.get("cap_usd", ANTHROPIC_MONTHLY_CAP_USD) - doc.get("spend_usd", 0)),
        "model": ANTHROPIC_MODEL,
    }


async def _load_customer_registry(limit: int = 5000) -> List[Dict[str, str]]:
    """Fetch the full customer list for prompt injection (D-136 REGISTRY tag)."""
    cursor = db[COL_CUSTOMERS].find({}, {"_id": 0, "code": 1, "name": 1}).limit(limit)
    return await cursor.to_list(length=limit)


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
    if not ANTHROPIC_API_KEY:
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
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 8192,
        # Prompt caching: the big knowledge prompt is cached (ephemeral 5m TTL); billed once
        # then re-used across parses at ~10x discount. Mirrors legacy line 838.
        "system": [{
            "type": "text",
            "text": knowledge_text,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": full_content}],
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(ANTHROPIC_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            raise HTTPException(resp.status_code, f"Anthropic API: {resp.text[:500]}")
        data = resp.json()

    usage = data.get("usage") or {}
    await _record_spend(
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
        usage.get("cache_read_input_tokens", 0),
        usage.get("cache_creation_input_tokens", 0),
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

    return {
        **normalized,
        "model": data.get("model"),
        "usage": usage,
        "stop_reason": data.get("stop_reason"),
        "estimated_input_tokens": estimated,
    }


@router.post("/parse-rfq")
async def parse_rfq(
    files: List[UploadFile] = File(default=[]),
    email_body: Optional[str] = Form(default=None),
    notes: Optional[str] = Form(default=None),
    _u: User = Depends(get_current_user),
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

    for f in files:
        content = await f.read()
        if not content:
            continue
        size = len(content)
        b64 = base64.standard_b64encode(content).decode("utf-8")
        media_type = f.content_type or "application/octet-stream"
        if media_type == "application/pdf" or (f.filename or "").lower().endswith(".pdf"):
            content_parts.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
            })
            file_summary.append({"name": f.filename, "type": "pdf", "size": size})
        elif media_type.startswith("image/"):
            content_parts.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })
            file_summary.append({"name": f.filename, "type": "image", "size": size})
        else:
            try:
                text = content.decode("utf-8", errors="replace")
            except Exception:
                text = "<binary content>"
            content_parts.append({"type": "text", "text": f"ATTACHMENT ({f.filename}):\n\n{text[:50000]}"})
            file_summary.append({"name": f.filename, "type": "text", "size": size})

    result = await _call_anthropic(content_parts)
    return {
        **result,
        "files": file_summary,
    }
