"""
CAD cutting recalibration from 6-month ERP actuals (LG Zund / Sm Zund / Kongsburg).

Goal: ignore the ERP's unreliable Complexity tags. Reclassify every component by
the rule-density ratio = (rule inches per piece) / (perimeter per piece), where
rule-per-piece = InchesOfRule / Ups  (InchesOfRule is per-impression, all ups).
Then derive clean Setup minutes and per-sheet run minutes for each bucket,
trimming outliers via IQR fences.

SPOT current defaults (for comparison):
  Setup min   -> Simple 8  / Standard 25 / Complex 22
  Run min/sht -> Simple 2  / Standard 2  / Complex 4
  Rate        -> $138/hr fully burdened
"""
import csv, statistics as st
from collections import defaultdict

PATH = "/app/analysis/cad_data.tsv"

def f(x):
    try: return float(x)
    except: return None

rows = []
with open(PATH) as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        w, h = f(r["FlatWidth"]), f(r["FlatHeight"])
        ups = f(r["Ups"]) or 1
        ir  = f(r["InchesOfRule"]) or 0
        if not w or not h or w <= 0 or h <= 0:
            continue
        perim = 2 * (w + h)
        rule_pp = ir / ups if ups else 0
        ratio = rule_pp / perim if perim else 0
        rows.append({
            "job": r["jobNumber"], "wc": r["work_center_desc"],
            "name": r["JobComponentName"], "erp": r["Complexity"],
            "ir": ir, "perim": perim, "ups": ups, "rule_pp": rule_pp,
            "ratio": ratio, "sheets": f(r["Sheets"]) or 0,
            "cis": int(f(r["ComponentsInSubJob"]) or 1),
            "setup_h": f(r["SetupHours"]) or 0, "run_h": f(r["RunHours"]) or 0,
        })

# ---- classification thresholds (tunable) ----
LO, HI = 1.5, 3.0          # ratio < LO Simple; LO..HI Standard; >= HI Complex
def bucket(ratio):
    if ratio < LO: return "Simple"
    if ratio < HI: return "Standard"
    return "Complex"

for r in rows:
    r["new"] = bucket(r["ratio"])

# ---- ratio distribution + ERP agreement ----
print("="*70)
print("RATIO DISTRIBUTION (rule-per-piece / perimeter)  — N =", len(rows))
rr = sorted(x["ratio"] for x in rows)
def pct(p): 
    i = min(len(rr)-1, int(p/100*len(rr)))
    return rr[i]
for p in (5,10,25,50,75,90,95):
    print(f"  p{p:>2}: {pct(p):6.2f}")
print(f"  min {rr[0]:.2f}  max {rr[-1]:.2f}  mean {st.mean(rr):.2f}")

print("\nNEW bucket counts (ratio rule):")
cnt = defaultdict(int)
for r in rows: cnt[r["new"]] += 1
for b in ("Simple","Standard","Complex"): print(f"  {b:9} {cnt[b]:4d}")

print("\nERP tag vs NEW classification (confusion):")
conf = defaultdict(int)
for r in rows: conf[(r["erp"], r["new"])] += 1
hdr = "ERP vs"
print(f"  {hdr:12}{'Simple':>9}{'Standard':>9}{'Complex':>9}")
for e in ("Simple","Standard","Complex"):
    print(f"  {e:12}" + "".join(f"{conf[(e,n)]:9d}" for n in ("Simple","Standard","Complex")))
agree = sum(conf[(b,b)] for b in ("Simple","Standard","Complex"))
print(f"  agreement: {agree}/{len(rows)} = {agree/len(rows)*100:.0f}%")

# ---- aggregate to sub-job (job, work_center): setup & run are SHARED across components ----
groups = defaultdict(lambda: {"sheets":0.0, "setup_h":None, "run_h":None,
                              "cis":1, "buckets":[], "names":set()})
for r in rows:
    g = groups[(r["job"], r["wc"])]
    if r["name"] not in g["names"]:
        g["sheets"] += r["sheets"]; g["names"].add(r["name"])
    g["setup_h"] = r["setup_h"]; g["run_h"] = r["run_h"]; g["cis"] = r["cis"]
    g["buckets"].append(r["new"])

# Dominant bucket of a sub-job = highest complexity present (Complex>Standard>Simple)
ORDER = {"Simple":0,"Standard":1,"Complex":2}
def dominant(bks): return max(bks, key=lambda b: ORDER[b])

# single-component sub-jobs = cleanest signal
setup_by = defaultdict(list)      # setup minutes (fresh runs, setup>0)
runrate_by = defaultdict(list)    # run min / sheet (run>0, sheets>0)
for (job,wc), g in groups.items():
    if g["cis"] != 1:             # only single-component sub-jobs
        continue
    b = dominant(g["buckets"])
    if g["setup_h"] > 0:
        setup_by[b].append(g["setup_h"]*60)
    if g["run_h"] > 0 and g["sheets"] > 0:
        runrate_by[b].append(g["run_h"]*60 / g["sheets"])

def trim_iqr(xs):
    if len(xs) < 4: return xs
    s = sorted(xs); n=len(s)
    q1, q3 = s[n//4], s[(3*n)//4]
    iqr = q3-q1; lo, hi = q1-1.5*iqr, q3+1.5*iqr
    return [x for x in s if lo <= x <= hi]

def summarize(label, by, cur):
    print("\n" + "="*70)
    print(f"{label}   (single-component sub-jobs only)")
    print(f"  {'bucket':9}{'N':>4}{'median':>9}{'trimMean':>10}{'p25':>8}{'p75':>8}{'SPOT now':>10}")
    for b in ("Simple","Standard","Complex"):
        xs = by[b]
        if not xs:
            print(f"  {b:9}{0:>4}"); continue
        t = trim_iqr(xs); s=sorted(xs); n=len(s)
        med = st.median(xs); tm = st.mean(t)
        p25, p75 = s[max(0,n//4)], s[min(n-1,(3*n)//4)]
        print(f"  {b:9}{len(xs):>4}{med:9.2f}{tm:10.2f}{p25:8.2f}{p75:8.2f}{cur[b]:>10.1f}")

summarize("SETUP MINUTES per sub-job", setup_by, {"Simple":8,"Standard":25,"Complex":22})
summarize("RUN MINUTES per SHEET",     runrate_by, {"Simple":2,"Standard":2,"Complex":4})

# multi-component sanity (run rate, shared setup distributed)
print("\n" + "="*70)
print("MULTI-COMPONENT sub-jobs (shared setup/run) — run min/sheet by dominant bucket")
mc = defaultdict(list)
for (job,wc), g in groups.items():
    if g["cis"] == 1: continue
    if g["run_h"]>0 and g["sheets"]>0:
        mc[dominant(g["buckets"])].append(g["run_h"]*60/g["sheets"])
for b in ("Simple","Standard","Complex"):
    xs=mc[b]
    if xs:
        t=trim_iqr(xs)
        print(f"  {b:9} N={len(xs):3d}  median {st.median(xs):.2f}  trimMean {st.mean(t):.2f}")

# ---- implied effective cut speed for "By Inches of Rule" mode ----
# SPOT rule-mode run time = rulePerPiece * pieces * 1.15 / SPEED(in/min)
# total rule cut over the run = IR(per sheet) * sheets ; runmin = run_h*60
# => effective SPEED = IR*sheets*1.15 / runmin   (keeps the 1.15 perf factor)
print("\n" + "="*70)
print("IMPLIED EFFECTIVE CUT SPEED (in/min)  — SPOT rule-mode uses 650 in/min")
print("  speed = ruleInches_per_sheet * sheets * 1.15 / run_minutes")
spd = defaultdict(list)
for (job,wc), g in groups.items():
    # need per-sheet rule inches: take from rows of this group (single-comp clean)
    if g["cis"] != 1: continue
    if g["run_h"]<=0 or g["sheets"]<=0: continue
    ir = next((r["ir"] for r in rows if r["job"]==job and r["wc"]==wc), 0)
    if ir<=0: continue
    speed = ir * g["sheets"] * 1.15 / (g["run_h"]*60)
    spd[dominant(g["buckets"])].append(speed)
print(f"  {'bucket':9}{'N':>4}{'median':>9}{'trimMean':>10}{'p25':>8}{'p75':>8}")
for b in ("Simple","Standard","Complex"):
    xs=spd[b]
    if not xs: continue
    t=trim_iqr(xs); s=sorted(xs); n=len(s)
    print(f"  {b:9}{len(xs):>4}{st.median(xs):9.0f}{st.mean(t):10.0f}{s[n//4]:8.0f}{s[(3*n)//4]:8.0f}")
allspd=[v for xs in spd.values() for v in xs]
print(f"  ALL       N={len(allspd):>3}  median {st.median(allspd):.0f}  trimMean {st.mean(trim_iqr(allspd)):.0f}")
