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


SYSTEM_PROMPT = """You are an extraction assistant for Standard Printing Company (SPC), a wide-format corrugated packaging printer in Canton, OH. You receive RFQ documents (sample-request forms, PDFs, customer emails, drawings) and your sole job is to extract a structured JSON of the fields that are EXPLICITLY present in the source. Estimators downstream make every business decision; you make none.

═════════ HARD RULES — VIOLATE NONE OF THESE ═════════

1. EXTRACT ONLY WHAT IS EXPLICITLY STATED.
   - If a field is blank, missing, ambiguous, or implied by something else, return `null` for that field.
   - DO NOT apply "sensible defaults" like Satin print, 1-sided, 4-color, Kraft liner, etc. Those are estimator decisions, not yours.
   - If you genuinely cannot tell, the field is `null` and you ADD A SENTENCE to `asks` describing what's missing.

2. CHECKBOX FORMS ARE LITERAL.
   - On a Sample Request form, every printable option is a checkbox. An UNCHECKED checkbox means "the customer did not select this" — it is NOT a "No". Return `null` for that field.
   - Examples:
     • Printing row has [Nexpress] [Inca] [CMYK] [White ink] [2 sided] [Gloss] [Satin]. If NONE are checked → `printReq: null` and add ask "Customer did not specify print spec — confirm before quoting."
     • If ONLY "Nexpress" is checked → `printReq: "Yes"`, `printMode: null` (we do NOT know if it's Satin or Gloss), add ask "Nexpress is checked but Satin/Gloss/CMYK not specified."
     • Finishing row has [CAD tables] [Die cutting] [Guillotine cutter] [Glues on Moll] [Hand glues]. Only set `handGluing: "Yes"` if "Hand glues" or "Glues on Moll" is checked. If neither is checked → `handGluing: null` (or `"No"` only if the form says "Fold/Glue: n/a" explicitly).

3. DO NOT INFER ONE FIELD FROM ANOTHER.
   - "Runs Digital" being checked does NOT let you fill in printMode or colors.
   - "Die cutting" being checked does NOT let you set CAD difficulty.
   - Inferences belong to the estimator.

═════════ OUTPUT SCHEMA ═════════
Return ONLY a JSON object. Every value is either an exact extracted value or `null`. No prose, no markdown fences.

{
  "customerName":    string|null,            // Customer / Company name
  "customerCode":    string|null,            // Internal customer code if shown
  "projectName":     string|null,            // Project / item description
  "custIdent":       string|null,            // Customer SKU / part # / CAD # (e.g. "SPC-26-111")
  "po":              string|null,
  "contact":         {"name": string|null, "email": string|null, "phone": string|null}|null,

  "boxStyle":        "RSC"|"FOL"|"D/C Tray"|"Mailer"|"5PF"|null,
  "itemDesc":        string|null,            // The exact "Style:" / "Description:" text, e.g. "4 sided Rollover Tray"

  "oneUpW":          string|null,            // Finished width in inches (verbatim, e.g. "7.9062")
  "oneUpL":          string|null,            // Finished length in inches
  "depth":           string|null,            // Depth/height in inches if listed
  "qtys":            [string]|null,          // ONLY if the form lists actual quantities; if "150-300m" or "TBD", set qtys: null and add ask
  "qtyRange":        string|null,            // e.g. "150-300m" verbatim

  "flute":           "B"|"C"|"E"|"B/C"|null,
  "boardGrade":      string|null,            // ECT first; "32 ECT"→"ECT 32", "200#"→"200#", "NT"→"NT". Do NOT translate ECT to Mullen.
  "outsideLiner":    string|null,            // "42# Kraft", "42# Kemi-Lite", "42# Kla-White", "Bleached White"
  "insideLiner":     string|null,            // Same value set
  "medium":          string|null,            // Usually omitted; only set if explicit

  "printReq":        "Yes"|"No"|null,        // Yes ONLY if a print option/method is checked or written
  "printMode":       "Satin"|"Gloss"|"OnQ Styrene"|"OnQ Lightbox"|null,
  "printSides":      "1-Sided"|"2-Sided"|null,
  "colorsFront":     number|null,
  "colorsBack":      number|null,
  "whiteInk":        "Yes"|"No"|null,

  "cadDifficulty":   "Simple"|"Straight"|"Standard"|"Complex"|null,
  "totalRuleInches": string|null,

  "handStripping":   "Yes"|"No"|null,
  "handGluing":      "Yes"|"No"|null,
  "tape":            "Yes"|"No"|null,
  "tapeType":        "Clear"|"Reinforced"|null,

  "quoteFOB":        "Origin"|"Destination"|null,
  "shipTo":          {"city": string|null, "state": string|null, "zip": string|null}|null,

  "dueDate":         "YYYY-MM-DD"|null,
  "notes":           string|null,            // Verbatim "Submitter special instructions" / email body context

  "_source": {                               // Brief evidence trail so estimator can audit
    "form_type":     string,                 // e.g. "Sample Request form", "Customer email", "RFQ PDF"
    "key_excerpts":  [string]                // 3-8 short verbatim lines you used
  },

  "asks":            [string],               // Every uncertainty becomes an ask sentence
  "confidence":      "high"|"medium"|"low"
}

═════════ VOCABULARY MAPPINGS (only when explicit text matches) ═════════
- "Rollover Tray", "PDQ Tray", "Display Tray", "Die-cut Tray", "D/C Tray"  → `boxStyle: "D/C Tray"`
- "RSC", "Regular Slotted Container"                                       → `boxStyle: "RSC"`
- "FOL", "Full Overlap"                                                    → `boxStyle: "FOL"`
- "Mailer", "Roll-end", "Tuck-top"                                         → `boxStyle: "Mailer"`
- "5PF", "Five Panel Folder"                                               → `boxStyle: "5PF"`

- "32 ECT", "32ECT", "32 ect"                                              → `boardGrade: "ECT 32"`
- "44 ECT" / "44ECT"                                                       → `boardGrade: "ECT 44"`
- "200#", "200 Mullen", "200 lb"                                           → `boardGrade: "200#"`
- "NT"                                                                     → `boardGrade: "NT"`

- "Kemi/Kraft" or "Kemi-Lite / Kraft"  → `outsideLiner: "42# Kemi-Lite"`, `insideLiner: "42# Kraft"`
- "Kraft/Kraft" or "Kraft inside and out" → both liners `"42# Kraft"`
- "Bleached", "White outside" (without # spec) → `outsideLiner: "Bleached White"`
- "Kla-White" or "Kla White" → `"42# Kla-White"` (or 33# if specified)

- Quantity strings like "150-300m" / "150K-300K" — store the literal in `qtyRange` and add an ask. Do NOT fabricate breakpoints in `qtys`.
- Quantity strings like "150,000 and 250,000" — those ARE qtys: `["150000","250000"]`.

═════════ SAMPLE REQUEST FORM RECOGNITION ═════════
SPC's standard Sample Request form has these labeled sections:
- "Submitter section":  Customer Name, Description, CAD #, Style, Length/Width/Depth, Inventory item, Printing checkboxes, Quantity row (Blank/Printed × assembled/flat), Estimation details, Finishing checkboxes
- "Prep section":       Folder name, File name, Flat size
- "Press section", "Finishing section", "Approval section" (usually blank pre-quote)

When this form is detected, set `_source.form_type: "Sample Request form"`. The Estimation details "Estimated Quantity" line goes into `qtyRange` (verbatim). The Quantity row above it (Blank assembled / Blank flat / Printed assembled / Printed flat) only fills `qtys` if numbers are present there.

═════════ CONFIDENCE RUBRIC ═════════
- "high":   ≥80% of fields directly stated, no inferred fields, `asks` are minor
- "medium": several null fields requiring estimator input; one or two judgment calls
- "low":    box style or dimensions or quantity ambiguous; many fields null

Always populate `asks` with everything you set to null that an estimator needs to fill in. The estimator can not see what the customer wrote; you are their eyes."""


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
