"""What-if on the matched print set: new Inca speeds (by finish or single) + setup minutes/pass.
Uses SPOT's own sheet counts (its layout) so the result is what customers would actually see."""
import json
import sys
from collections import defaultdict

import openpyxl

sys.path.insert(0, "/app/analysis/print")
from build_print_parity import QTY_BANDS, SP_SPEED, spot_formula, write_sheet, r2  # noqa: E402

HERE = "/app/analysis/print"
rows = [r for r in json.load(open(f"{HERE}/print_parity_data.json"))["matched"]
        if not r["iQ Ganged"] and r["Same Finish"] == "Yes" and r["iQ Print $"] > 0
        and r["SPOT Print Mode"] in ("Satin", "Gloss")]


def spot_print(r, speeds, setup_min, rate=485.0, pass2_full=False, coverage=False):
    """coverage=True uses iQuote's per-product ink $/sqft as a stand-in for an estimator-picked coverage tier."""
    mode = r["SPOT Print Mode"]
    two = r["SPOT Sides"] == "2-Sided"
    sq = float(r["SPOT Sheet W"]) * float(r["SPOT Sheet L"]) / 144
    ink = (r["iQ Ink $/sqft/pass"] or 0.05) if coverage else 0.05
    f = spot_formula(r["SPOT Sheets"], sq, mode, r["SPOT White Ink"] == "Yes", False,
                     speed=speeds[mode], setup_min=setup_min, rate=rate, ink=ink)
    side1 = f["press"] + f["ink"] + f["white"]
    return side1 * (2 if (two and pass2_full) else (1.6 if two else 1))


SCENARIOS = {
    "A. Today 75-75 @485, no setup": dict(speeds={"Satin": 75, "Gloss": 75}, setup_min=0, rate=485),
    "B. Single 160 @485, no setup": dict(speeds={"Satin": 160, "Gloss": 160}, setup_min=0, rate=485),
    "C. By finish 190-135 @485, no setup": dict(speeds={"Satin": 190, "Gloss": 135}, setup_min=0, rate=485),
    "D. By finish 190-135 @485 +10min": dict(speeds={"Satin": 190, "Gloss": 135}, setup_min=10, rate=485),
    "F. iQuote 144-102 @319 +10min": dict(speeds={"Satin": 144, "Gloss": 102}, setup_min=10, rate=319),
    "G. iQuote 144-102 @319 +7min": dict(speeds={"Satin": 144, "Gloss": 102}, setup_min=7, rate=319),
    "H. G + 2-sided as full 2nd pass": dict(speeds={"Satin": 144, "Gloss": 102}, setup_min=7, rate=319, pass2_full=True),
    "I. H + ink coverage tiers": dict(speeds={"Satin": 144, "Gloss": 102}, setup_min=7, rate=319, pass2_full=True, coverage=True),
}


def band_table(fn):
    g = defaultdict(list)
    for r in rows:
        g[r["Qty Band"]].append(r)
    out = []
    for lab, *_ in QTY_BANDS:
        rs = g.get(lab)
        if not rs:
            continue
        sp = sum(fn(r) for r in rs)
        iq = sum(r["iQ Print $"] for r in rs)
        pcts = sorted((fn(r) - r["iQ Print $"]) / r["iQ Print $"] * 100 for r in rs)
        mape = sum(abs(p) for p in pcts) / len(pcts)
        out.append({"Qty Band": lab, "Rows": len(rs), "SPOT $": r2(sp), "iQ $": r2(iq),
                    "Δ % agg": round((sp - iq) / iq * 100, 1), "Δ % median": round(pcts[len(pcts) // 2], 1),
                    "MAPE %": round(mape, 1), "Rows within ±20%": sum(1 for p in pcts if abs(p) <= 20)})
    return out


def finish_table(fn):
    out = []
    for fin in ("Satin", "Gloss"):
        rs = [r for r in rows if r["SPOT Print Mode"] == fin]
        sp = sum(fn(r) for r in rs); iq = sum(r["iQ Print $"] for r in rs)
        pcts = [(fn(r) - r["iQ Print $"]) / r["iQ Print $"] * 100 for r in rs]
        out.append({"Finish": fin, "Rows": len(rs), "SPOT $": r2(sp), "iQ $": r2(iq),
                    "Δ % agg": round((sp - iq) / iq * 100, 1), "MAPE %": round(sum(abs(p) for p in pcts) / len(pcts), 1)})
    return out


def main():
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    overview = []
    for name, kw in SCENARIOS.items():
        speeds, setup, rate = kw["speeds"], kw["setup_min"], kw["rate"]
        fn = lambda r, kw=kw: spot_print(r, **kw)  # noqa: E731
        bt = band_table(fn); ft = finish_table(fn)
        sp = sum(fn(r) for r in rows); iq = sum(r["iQ Print $"] for r in rows)
        pcts = [(fn(r) - r["iQ Print $"]) / r["iQ Print $"] * 100 for r in rows]
        overview.append({"Scenario": name, "Satin sh/hr": speeds["Satin"], "Gloss sh/hr": speeds["Gloss"], "Setup min/pass": setup, "$/hr": rate, "2-sided": "full 2nd pass" if kw.get("pass2_full") else "+60%", "Ink": "coverage tiers" if kw.get("coverage") else "flat $0.05",
                         "Δ % all rows": round((sp - iq) / iq * 100, 1), "MAPE % all": round(sum(abs(p) for p in pcts) / len(pcts), 1),
                         **{f"Δ% {b['Qty Band']}": b["Δ % agg"] for b in bt},
                         **{f"Δ% {f['Finish']}": f["Δ % agg"] for f in ft},
                         "Rows within ±20%": sum(1 for p in pcts if abs(p) <= 20), "Rows": len(rows)})
        print(f"\n{name}"); [print("  ", b) for b in bt]; [print("  ", f) for f in ft]
        write_sheet(wb, name[:31].replace("/", "-"), bt + [{}] + ft)
    ws = wb.create_sheet("Overview", 0)
    write_sheet(wb, "_tmp", overview)
    tmp = wb["_tmp"]
    for row in tmp.iter_rows(values_only=True):
        ws.append(list(row))
    wb.remove(tmp)
    for c in ws[1]:
        c.font = openpyxl.styles.Font(bold=True)
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = 16
    ws.column_dimensions["A"].width = 42
    wb.save(f"{HERE}/Print_Speed_Scenarios.xlsx")
    print("\nOVERVIEW"); [print(o) for o in overview]


if __name__ == "__main__":
    main()
