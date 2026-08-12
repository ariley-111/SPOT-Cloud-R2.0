"""Fleet regression — 785-job iQuote-vs-SPOT parity validation.

Python port of fleet_compare.js. Reads WF_Quoting_Tool_Test_Data.xlsx,
maps each row to a SPOT estimate JSON, runs through the Python engine,
compares output to iQuote's TotalActualCost.

Acceptance: R² ≥ 0.969 (matches D-110 FINAL baseline).

Usage:
    cd /app/backend && python -m tests.fleet_regression
"""
from __future__ import annotations
import json as _json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Make engine importable when run as script
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import openpyxl  # noqa: E402

from engine import (  # noqa: E402
    run_estimate, SPOT_SCHEMA_VERSION, CAD_DIFF_MIGRATION,
)


XLSX_PATH = Path(__file__).parent / "fixtures" / "WF_Quoting_Tool_Test_Data.xlsx"
CREST_DIE_ADJUSTMENT = 1200  # D-110 FINAL


def migrate_tier(v: Optional[str], mapping: Dict[str, str]) -> Optional[str]:
    if not v:
        return v
    if v in mapping and mapping[v] != v:
        return mapping[v]
    return v


def parse_board(spec: Optional[str], flute_col: Optional[str]) -> Dict[str, Any]:
    """Parse iQuote BoardSpecsFull into (grade, flute, outsideLiner, insideLiner).

    Mirrors fleet_compare.js L73-120.
    """
    out: Dict[str, Any] = {"ok": False, "reason": None}
    if not spec:
        out["reason"] = "empty spec"
        return out

    grade: Optional[str] = None
    pct_m = re.search(r"(\d+)#", spec)
    ect_m = re.search(r"(\d+)\s*ect", spec, re.IGNORECASE) or re.search(r"ECT\s*(\d+)", spec, re.IGNORECASE)
    if pct_m:
        grade = pct_m.group(1)
    elif ect_m:
        grade = "ECT " + ect_m.group(1)
    if not grade:
        out["reason"] = f'no grade (# or ect) found in "{spec}"'
        return out

    flute = None
    f_m = re.search(r"\b([BCE])\s*Flute", flute_col or "", re.IGNORECASE)
    if f_m:
        flute = f_m.group(1).upper()
    if not flute:
        f_m2 = re.search(r"\b([BCE])\s*Flute", spec, re.IGNORECASE)
        if f_m2:
            flute = f_m2.group(1).upper()
    if not flute:
        out["reason"] = f'no flute in "{flute_col or spec}"'
        return out

    liner_m = re.search(r"(Kemi|KLA|Kraft|Bleached|White)\s*/\s*(Kemi|KLA|Kraft|Bleached|White)",
                        spec, re.IGNORECASE)
    liner_map = {
        "kemi": "42# Kemi-Lite",
        "kla": "42# Kla-White",
        "kraft": "None",
        "bleached": "42# Bleached White",
        "white": "42# Kla-White",
    }
    outside_liner = "42# Kemi-Lite"
    inside_liner = "None"
    if liner_m:
        outside_liner = liner_map.get(liner_m.group(1).lower(), outside_liner)
        inside_liner = liner_map.get(liner_m.group(2).lower(), inside_liner)

    out["ok"] = True
    out["boardGrade"] = grade
    out["flute"] = flute
    out["outsideLiner"] = outside_liner
    out["insideLiner"] = inside_liner
    out["fscEnabled"] = bool(re.search(r"FSC", spec, re.IGNORECASE))
    return out


def _to_float(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def _to_int(v: Any) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return 0


def build_spot_json(row: Dict[str, Any]) -> Dict[str, Any]:
    qty = _to_int(row.get("Quantity"))
    w = _to_float(row.get("FinishedWidth"))
    l = _to_float(row.get("FinishedLength"))
    if not qty or not w or not l:
        return {"ok": False, "reason": "missing qty/dims"}

    parsed = parse_board(row.get("BoardSpecsFull"), row.get("Flute"))
    if not parsed["ok"]:
        return {"ok": False, "reason": parsed["reason"]}

    cad_difficulty = (row.get("ComplexityOfCut") or "").strip() or "Standard"
    if cad_difficulty not in {"Simple", "Straight", "Standard", "Complex"}:
        cad_difficulty = migrate_tier(cad_difficulty, CAD_DIFF_MIGRATION) or "Standard"

    cf = _to_int(row.get("ColorsFront"))
    cb = _to_int(row.get("ColorsBack"))
    print_req = "Yes" if (cf + cb) > 0 else "No"
    print_sides = "2-Sided" if cb > 0 else "1-Sided"

    cips = _to_float(row.get("CuttingInchesPerSheet"))
    n_up = _to_int(row.get("NumberUp")) or 1
    rule_per_pc = cips / n_up if cips > 0 else 0
    use_rule_inches = rule_per_pc > 0

    iq_hand_glue = _to_float(row.get("ActualHandglueCost"))
    hand_gluing = "Yes" if iq_hand_glue > 0 else "No"

    return {
        "ok": True,
        "json": {
            "schemaVersion": SPOT_SCHEMA_VERSION,
            "oneUpW": str(w),
            "oneUpL": str(l),
            "qtys": [str(qty)],
            "flute": parsed["flute"],
            "boardGrade": parsed["boardGrade"],
            "outsideLiner": parsed["outsideLiner"],
            "insideLiner": parsed["insideLiner"],
            "medium": "None",
            "fscEnabled": parsed["fscEnabled"],
            "fscFee": "25" if parsed["fscEnabled"] else "0",
            "under5MsfFee": "0",
            "cadPricingMethod": "By Inches of Rule" if use_rule_inches else "By Difficulty",
            "totalRuleInches": str(rule_per_pc) if use_rule_inches else "0",
            "cadDifficulty": cad_difficulty,
            "printReq": print_req,
            "printMode": "Satin",
            "printSides": print_sides,
            "whiteInk": "No",
            "handStripping": "No",
            "handGluing": hand_gluing,
            "tape": "No",
            "quoteFOB": "Origin",
        },
    }


def read_xlsx(path: Path) -> List[Dict[str, Any]]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    header_norm = [str(h) if h is not None else "" for h in header]
    result = []
    for row in rows_iter:
        if row is None:
            continue
        d = {header_norm[i]: row[i] for i in range(len(header_norm))}
        result.append(d)
    return result


def median(vs: List[float]) -> float:
    if not vs:
        return 0.0
    s = sorted(vs)
    return s[len(s) // 2]


def mean(vs: List[float]) -> float:
    return sum(vs) / len(vs) if vs else 0.0


def quantile(vs: List[float], q: float) -> float:
    if not vs:
        return 0.0
    s = sorted(vs)
    idx = min(len(s) - 1, int(len(s) * q))
    return s[idx]


def main() -> int:
    if not XLSX_PATH.exists():
        print(f"ERROR: xlsx not found at {XLSX_PATH}", file=sys.stderr)
        return 1

    # Option-C freeze: this regression harness measures parity vs the D-110 FINAL
    # baseline, which was calibrated with E-flute upcharge = $0/MSF. In R2.x we
    # restored $3/MSF for E and added E/B at $6/MSF as a deliberate business
    # decision. To keep the D-110 R² comparable, we temporarily zero out those
    # upcharges here so the fleet re-runs under the same conditions the baseline
    # was set under. This is a scientific-reproducibility knob, NOT a real
    # pricing rollback — production pricing keeps the restored upcharges.
    from engine.core import ENGINE as _ENGINE
    _saved = {k: _ENGINE["flute_rules"][k]["flute_upcharge_per_msf"]
              for k in _ENGINE["flute_rules"]}
    _ENGINE["flute_rules"]["E"]["flute_upcharge_per_msf"] = 0
    if "E/B" in _ENGINE["flute_rules"]:
        _ENGINE["flute_rules"]["E/B"]["flute_upcharge_per_msf"] = 0
    print("[fleet-regression] D-110 freeze active: E and E/B upcharges pinned to $0 "
          "for R² comparison. Production values (E=$3, E/B=$6) unaffected.")

    print(f"Reading {XLSX_PATH} ...")
    rows = read_xlsx(XLSX_PATH)
    print(f"  rows: {len(rows)}")

    results: List[Dict[str, Any]] = []
    unparseable: List[Dict[str, Any]] = []
    ok_count = 0
    err_count = 0

    t0 = time.time()
    for row in rows:
        built = build_spot_json(row)
        if not built.get("ok"):
            unparseable.append({"JobNumber": row.get("JobNumber"), "reason": built.get("reason"),
                                "spec": row.get("BoardSpecsFull")})
            err_count += 1
            continue

        try:
            r = run_estimate(built["json"], 0)
        except Exception as e:
            unparseable.append({"JobNumber": row.get("JobNumber"),
                                "reason": f"engine exception: {type(e).__name__}: {e}",
                                "spec": row.get("BoardSpecsFull")})
            err_count += 1
            continue

        if r.get("error"):
            unparseable.append({"JobNumber": row.get("JobNumber"), "reason": "runner: " + r["error"],
                                "spec": row.get("BoardSpecsFull")})
            err_count += 1
            continue

        die_adj = CREST_DIE_ADJUSTMENT if r.get("route") == "Crest" else 0
        spot_prod = ((r.get("matTotal") or 0) + (r.get("matMakeready") or 0)
                     + (r.get("printDirect") or 0)
                     + (r.get("cutterDirect") or 0) - (r.get("dieEmbedded") or 0)
                     + (r.get("stripCost") or 0) + (r.get("assemblyCost") or 0)
                     + (r.get("saberCost") or 0)
                     + die_adj)
        spot_full = r.get("totalMfg") or 0
        iq_total = _to_float(row.get("TotalActualCost"))

        delta_prod = spot_prod - iq_total
        delta_prod_pct = (delta_prod / iq_total) * 100 if iq_total > 0 else 0
        delta_full = spot_full - iq_total
        delta_full_pct = (delta_full / iq_total) * 100 if iq_total > 0 else 0

        results.append({
            "JobNumber": row.get("JobNumber"),
            "Tier": built["json"]["cadDifficulty"],
            "Route": r.get("route"),
            "iQuoteTotal": iq_total,
            "SpotProdOnly": spot_prod,
            "SpotFullMfg": spot_full,
            "DeltaProd": delta_prod,
            "DeltaProdPct": delta_prod_pct,
            "DeltaFullPct": delta_full_pct,
        })
        ok_count += 1

    elapsed = time.time() - t0

    # Stats
    deltas = [r["DeltaProd"] for r in results]
    delta_pcts = [r["DeltaProdPct"] for r in results]
    spot_totals = [r["SpotProdOnly"] for r in results]
    iq_totals = [r["iQuoteTotal"] for r in results]

    my = mean(iq_totals)
    ss_tot = sum((y - my) ** 2 for y in iq_totals)
    ss_res = sum((y - spot_totals[i]) ** 2 for i, y in enumerate(iq_totals))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    sum_spot = sum(spot_totals)
    sum_iq = sum(iq_totals)
    fleet_total_pct = ((sum_spot - sum_iq) / sum_iq * 100) if sum_iq > 0 else 0

    by_tier: Dict[str, Dict[str, Any]] = {}
    for r in results:
        t = r["Tier"]
        if t not in by_tier:
            by_tier[t] = {"n": 0, "sumDeltaPct": 0, "dps": []}
        by_tier[t]["n"] += 1
        by_tier[t]["sumDeltaPct"] += r["DeltaProdPct"]
        by_tier[t]["dps"].append(r["DeltaProdPct"])
    for t in by_tier:
        by_tier[t]["medianPct"] = median(by_tier[t]["dps"])
        by_tier[t]["meanPct"] = by_tier[t]["sumDeltaPct"] / by_tier[t]["n"]
        del by_tier[t]["dps"]
        del by_tier[t]["sumDeltaPct"]

    summary = {
        "schema": SPOT_SCHEMA_VERSION,
        "crestDieAdjustment": CREST_DIE_ADJUSTMENT,
        "counts": {"totalRows": len(rows), "scored": ok_count, "unparseable": err_count},
        "fleet": {
            "medianDelta": median(deltas),
            "meanDelta": mean(deltas),
            "medianDeltaPct": median(delta_pcts),
            "meanDeltaPct": mean(delta_pcts),
            "p5DeltaPct": quantile(delta_pcts, 0.05),
            "p95DeltaPct": quantile(delta_pcts, 0.95),
            "r2": r2,
            "sumSpot": sum_spot,
            "sumIquote": sum_iq,
            "fleetTotalPct": fleet_total_pct,
        },
        "byTier": by_tier,
        "elapsedSec": elapsed,
    }

    out_dir = Path(__file__).parent / "regression_output"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "fleet_summary.json").write_text(_json.dumps(summary, indent=2, default=str))

    # CSVs
    def to_csv(rows: List[Dict[str, Any]], cols: List[str]) -> str:
        def esc(v: Any) -> str:
            s = "" if v is None else str(v)
            return f'"{s}"' if any(c in s for c in [",", '"', "\n"]) else s

        body_lines = [",".join(cols)]
        for r in rows:
            body_lines.append(",".join(esc(r.get(c, "")) for c in cols))
        return "\n".join(body_lines) + "\n"

    (out_dir / "fleet_results.csv").write_text(to_csv(
        results, ["JobNumber", "Tier", "Route", "iQuoteTotal", "SpotProdOnly", "SpotFullMfg",
                  "DeltaProd", "DeltaProdPct", "DeltaFullPct"]))
    (out_dir / "fleet_unparseable.csv").write_text(to_csv(
        unparseable, ["JobNumber", "reason", "spec"]))

    # Console report
    print("\n" + "═" * 65)
    print("Fleet comparison summary")
    print("═" * 65)
    print(f"Scored: {ok_count}  Unparseable: {err_count}  Elapsed: {elapsed:.1f}s")
    print(f"Fleet total SPOT    : ${sum_spot:,.2f}")
    print(f"Fleet total iQuote  : ${sum_iq:,.2f}")
    print(f"Fleet total Δ %     : {fleet_total_pct:+.2f}%")
    print(f"Median per-job Δ %  : {summary['fleet']['medianDeltaPct']:+.2f}%")
    print(f"Mean per-job Δ %    : {summary['fleet']['meanDeltaPct']:+.2f}%")
    print(f"R² (SPOT vs iQuote) : {r2:.4f}")
    print(f"p5 Δ%, p95 Δ%       : {summary['fleet']['p5DeltaPct']:+.2f}% / {summary['fleet']['p95DeltaPct']:+.2f}%")
    print()
    print("Per-tier (n, median Δ%, mean Δ%):")
    for t in ["Simple", "Straight", "Standard", "Complex"]:
        if t not in by_tier:
            continue
        bt = by_tier[t]
        print(f"  {t:<10} n={bt['n']}  med={bt['medianPct']:+.2f}%  mean={bt['meanPct']:+.2f}%")
    print()
    print("Outputs (in tests/regression_output/):")
    print("  fleet_results.csv     (per-job)")
    print("  fleet_summary.json    (fleet stats)")
    print("  fleet_unparseable.csv (dropped rows)")
    print("═" * 65)

    # Gate check
    print()
    if r2 >= 0.969:
        print(f"✅ PARITY GATE PASSED — R² {r2:.4f} >= 0.969 baseline")
        return 0
    elif r2 >= 0.95:
        print(f"⚠️  CLOSE — R² {r2:.4f} (target 0.969). Diagnose top offenders.")
        return 2
    else:
        print(f"❌ PARITY GATE FAILED — R² {r2:.4f} < 0.969. Engine port has bugs.")
        return 3


if __name__ == "__main__":
    sys.exit(main())
