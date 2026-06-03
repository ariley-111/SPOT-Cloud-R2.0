"""SPOT Cloud — Parser usage tracking.

Logs every Anthropic parse call so we can answer:
  - Which customer drove our Anthropic $ this month / quarter / year?
  - Which estimator is parsing the most?
  - What's our average cost per RFQ?
  - Trend over time (line chart)

This data is the foundation for any future per-customer parse-billing
or cost-allocation analysis. Even if you never bill it, knowing where
spend goes is valuable when you eventually negotiate a higher Anthropic
tier or add more estimators.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db, COL_PARSER_USAGE

logger = logging.getLogger("spot.usage")


async def log_parse(
    *,
    user_email: str,
    est_initials: Optional[str],
    customer_code: Optional[str],
    customer_name: Optional[str],
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
    cost_usd: float,
    file_count: int,
    success: bool,
    error: Optional[str] = None,
) -> None:
    """Append one row to parser_usage. Never raises — usage logging
    must not break the parse call."""
    try:
        now = datetime.now(timezone.utc)
        doc = {
            "timestamp": now.isoformat(),
            "yyyymm": now.strftime("%Y-%m"),  # for quick month-rollup queries
            "user": user_email,
            "est_initials": (est_initials or "").upper() or None,
            "customer_code": customer_code or None,
            "customer_name": customer_name or None,
            "model": model,
            "tokens_in": int(input_tokens or 0),
            "tokens_out": int(output_tokens or 0),
            "tokens_cache_read":  int(cache_read_tokens or 0),
            "tokens_cache_write": int(cache_write_tokens or 0),
            "cost_usd": float(cost_usd or 0),
            "file_count": int(file_count or 0),
            "success": bool(success),
            "error": error,
        }
        await db[COL_PARSER_USAGE].insert_one(doc)
    except Exception as e:
        logger.error(f"usage: log_parse failed (non-fatal): {e}")


async def summary(
    months: int = 6,
    customer_code: Optional[str] = None,
) -> Dict[str, Any]:
    """Aggregate usage for the admin Usage tab.

    Returns:
      {
        "totals":   {calls, tokens_in, tokens_out, cost_usd},
        "by_month": [{yyyymm, calls, cost_usd, tokens_in, tokens_out}],
        "by_customer": [{customer_code, customer_name, calls, cost_usd}] (top 20),
        "by_estimator": [{est_initials, calls, cost_usd}],
        "recent": [last 50 individual calls (newest first)],
      }
    """
    # ── Date floor: last N months
    from dateutil.relativedelta import relativedelta  # type: ignore
    cutoff = (datetime.now(timezone.utc) - relativedelta(months=months)).strftime("%Y-%m")
    match: Dict[str, Any] = {"yyyymm": {"$gte": cutoff}}
    if customer_code:
        match["customer_code"] = customer_code

    # ── Grand totals
    totals_pipeline = [
        {"$match": match},
        {"$group": {"_id": None,
                    "calls":      {"$sum": 1},
                    "tokens_in":  {"$sum": "$tokens_in"},
                    "tokens_out": {"$sum": "$tokens_out"},
                    "cost_usd":   {"$sum": "$cost_usd"}}},
    ]
    totals_doc = await db[COL_PARSER_USAGE].aggregate(totals_pipeline).to_list(length=1)
    totals = (totals_doc[0] if totals_doc else
              {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0})
    totals.pop("_id", None)

    # ── By month
    by_month_pipeline = [
        {"$match": match},
        {"$group": {"_id": "$yyyymm",
                    "calls":      {"$sum": 1},
                    "cost_usd":   {"$sum": "$cost_usd"},
                    "tokens_in":  {"$sum": "$tokens_in"},
                    "tokens_out": {"$sum": "$tokens_out"}}},
        {"$sort": {"_id": 1}},
    ]
    by_month = [
        {"yyyymm": d["_id"], "calls": d["calls"], "cost_usd": round(d["cost_usd"], 4),
         "tokens_in": d["tokens_in"], "tokens_out": d["tokens_out"]}
        async for d in db[COL_PARSER_USAGE].aggregate(by_month_pipeline)
    ]

    # ── By customer (top 20 by cost)
    by_cust_pipeline = [
        {"$match": match},
        {"$group": {"_id": {"code": "$customer_code", "name": "$customer_name"},
                    "calls": {"$sum": 1}, "cost_usd": {"$sum": "$cost_usd"}}},
        {"$sort": {"cost_usd": -1}},
        {"$limit": 20},
    ]
    by_customer = [
        {"customer_code": d["_id"].get("code") or "—",
         "customer_name": d["_id"].get("name") or "—",
         "calls": d["calls"], "cost_usd": round(d["cost_usd"], 4)}
        async for d in db[COL_PARSER_USAGE].aggregate(by_cust_pipeline)
    ]

    # ── By estimator
    by_est_pipeline = [
        {"$match": match},
        {"$group": {"_id": "$est_initials", "calls": {"$sum": 1},
                    "cost_usd": {"$sum": "$cost_usd"}}},
        {"$sort": {"cost_usd": -1}},
    ]
    by_estimator = [
        {"est_initials": d["_id"] or "—", "calls": d["calls"],
         "cost_usd": round(d["cost_usd"], 4)}
        async for d in db[COL_PARSER_USAGE].aggregate(by_est_pipeline)
    ]

    # ── Recent calls
    recent_cursor = db[COL_PARSER_USAGE].find(match, {"_id": 0}).sort("timestamp", -1).limit(50)
    recent: List[Dict[str, Any]] = [d async for d in recent_cursor]

    return {
        "window": {"months": months, "since_yyyymm": cutoff, "customer_filter": customer_code},
        "totals": {
            "calls": int(totals.get("calls", 0)),
            "tokens_in": int(totals.get("tokens_in", 0)),
            "tokens_out": int(totals.get("tokens_out", 0)),
            "cost_usd": round(totals.get("cost_usd", 0), 4),
        },
        "by_month": by_month,
        "by_customer": by_customer,
        "by_estimator": by_estimator,
        "recent": recent,
    }
