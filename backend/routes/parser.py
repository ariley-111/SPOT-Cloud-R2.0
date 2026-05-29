"""RFQ Parser — Anthropic Opus 4.7 multimodal ingestion.

Accepts PDFs, images, and/or text email bodies. Parses to structured estimate
JSON matching the SPOT schema. Mirrors spot_server.js /est/parse-rfq.

Uses the existing Anthropic API (key from .env, NOT user-facing). Monthly
budget tracked in MongoDB parser_budget collection.
"""
from __future__ import annotations
import base64
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from db import db, COL_PARSER_BUDGET
from models.schemas import User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/parser", tags=["parser"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-7")
ANTHROPIC_MONTHLY_CAP_USD = float(os.environ.get("ANTHROPIC_MONTHLY_CAP_USD", "500"))
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

# Rough pricing per million tokens (USD) — for budget tracking only
MODEL_PRICING = {
    "claude-opus-4-7": {"input": 15.0, "output": 75.0},
    "claude-opus-4-6": {"input": 15.0, "output": 75.0},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
}


SYSTEM_PROMPT = """You are an estimating assistant for Standard Printing Company (SPC), a wide-format corrugated packaging printer in Canton, OH. You receive RFQ documents (PDFs, images, emails) from customers and your job is to extract a structured estimate JSON that matches SPOT's schema.

Return ONLY a valid JSON object with these fields (omit fields you can't determine):

{
  "customerName": string,            // Company name
  "customerCode": string,            // Internal customer code if visible (e.g. "JEFFRO-1")
  "projectName": string,             // Job/project name
  "po": string,                      // PO number if provided
  "contact": {"name": string, "email": string, "phone": string},

  "oneUpW": string,                  // Finished width in inches
  "oneUpL": string,                  // Finished length in inches
  "qtys": [string],                  // Up to 5 quantities to quote, e.g. ["1000","5000","10000"]

  "flute": "B" | "C" | "E" | "B/C",
  "boardGrade": string,              // "200", "250", "ECT 32", "ECT 44", etc.
  "outsideLiner": string,            // "42# Kemi-Lite", "42# Kla-White", "None" (=Kraft)
  "insideLiner": string,
  "medium": string,                  // Usually "None"

  "printReq": "Yes" | "No",
  "printMode": "Gloss" | "Satin",
  "printSides": "1-Sided" | "2-Sided",
  "colorsFront": number,             // # of process+spot colors front
  "colorsBack": number,
  "whiteInk": "Yes" | "No",

  "cadDifficulty": "Simple" | "Straight" | "Standard" | "Complex",
  "totalRuleInches": string,         // Inches of cutting rule per piece if known

  "handStripping": "Yes" | "No",
  "handGluing": "Yes" | "No",
  "tape": "Yes" | "No",
  "tapeType": "Clear" | "Reinforced",

  "quoteFOB": "Origin" | "Destination",
  "shipTo": {"city": string, "state": string, "zip": string},

  "dueDate": "YYYY-MM-DD",
  "notes": string,                   // Any context the estimator needs

  "asks": [string],                  // Questions YOU couldn't resolve from the docs — important
  "confidence": "high" | "medium" | "low"
}

RULES:
- Default printMode to "Satin" (SPOT's calibrated default), not "Gloss"
- Default printSides to "1-Sided" unless explicitly 2-sided
- Default insideLiner to "None" if not specified (= kraft inside)
- Use "ECT" prefix for ECT grades, e.g. "ECT 44" not "44ECT"
- Map "Kraft" outside/inside liner to "None" (SPOT's canonical name for unbleached)
- If colors not specified but printing is requested, assume 4-color process front
- If quantity not provided, ask in `asks`, do NOT make one up
- If dimensions are ambiguous (e.g. could be 12x18 OR 18x12), pick the more natural one based on context and note in `asks`
- ALWAYS populate `asks` with anything you're uncertain about — the estimator wants to know what they need to verify

Return ONLY the JSON object. No prose, no markdown fences."""


def _current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def _get_budget_doc() -> Dict[str, Any]:
    month = _current_month()
    doc = await db[COL_PARSER_BUDGET].find_one({"month": month}, {"_id": 0})
    if not doc:
        doc = {"month": month, "spend_usd": 0.0, "calls": 0, "cap_usd": ANTHROPIC_MONTHLY_CAP_USD}
        await db[COL_PARSER_BUDGET].insert_one(doc)
    return doc


async def _record_spend(input_tokens: int, output_tokens: int) -> Dict[str, Any]:
    pricing = MODEL_PRICING.get(ANTHROPIC_MODEL, {"input": 15.0, "output": 75.0})
    cost = (input_tokens / 1_000_000) * pricing["input"] + (output_tokens / 1_000_000) * pricing["output"]
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


async def _call_anthropic(content_parts: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")
    # Budget gate
    budget = await _get_budget_doc()
    if budget.get("spend_usd", 0) >= budget.get("cap_usd", ANTHROPIC_MONTHLY_CAP_USD):
        raise HTTPException(429, f"Monthly Anthropic budget cap reached (${budget['cap_usd']})")

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content_parts}],
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(ANTHROPIC_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            raise HTTPException(resp.status_code, f"Anthropic API: {resp.text[:500]}")
        data = resp.json()

    usage = data.get("usage") or {}
    await _record_spend(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")

    # Try to parse JSON out of the response (Anthropic sometimes wraps in fences)
    text_stripped = text.strip()
    if text_stripped.startswith("```"):
        # Strip code fences
        lines = text_stripped.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text_stripped = "\n".join(lines).strip()
    try:
        parsed = json.loads(text_stripped)
    except json.JSONDecodeError:
        # Try to extract first JSON object
        start = text_stripped.find("{")
        end = text_stripped.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text_stripped[start:end + 1])
            except json.JSONDecodeError:
                parsed = {"_raw": text, "_parse_error": "Could not extract JSON"}
        else:
            parsed = {"_raw": text, "_parse_error": "No JSON found in response"}

    return {
        "parsed": parsed,
        "model": data.get("model"),
        "usage": usage,
        "stop_reason": data.get("stop_reason"),
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
    email body (if provided) becomes a text block. The system prompt drives extraction.
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
        # Anthropic supports document (PDF) and image content blocks
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
            # Treat as text
            try:
                text = content.decode("utf-8", errors="replace")
            except Exception:
                text = "<binary content>"
            content_parts.append({"type": "text", "text": f"ATTACHMENT ({f.filename}):\n\n{text[:50000]}"})
            file_summary.append({"name": f.filename, "type": "text", "size": size})

    content_parts.append({
        "type": "text",
        "text": "Extract the SPOT estimate JSON from the above. Return ONLY the JSON object.",
    })

    result = await _call_anthropic(content_parts)
    return {
        **result,
        "files": file_summary,
    }
