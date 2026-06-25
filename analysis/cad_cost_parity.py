"""
Cost parity: ACTUAL (actual hrs x ERP machine rate) vs SPOT modeled cutting cost.

ERP machine rates:  LG Zund 69, Sm Zund 69, Kongsburg 72  ($/hr).
SPOT quotes cutting at $138/hr fully-burdened.

SPOT rule-mode cutting time (engine/pricing.py L79-98):
   runtime_min = ruleInches_per_piece * upsPerSheet * 1.15 * sheets / SPEED
              = IR_per_sheet * 1.15 * sheets / SPEED          (since IR=rule*ups)
   cad_hrs     = (setup_min[diff] + runtime_min) / 60
   cost        = cad_hrs * RATE

We restrict to SINGLE-component sub-jobs (clean 1:1; setup+run not shared).
"""
import csv, statistics as st
from collections import defaultdict

PATH="/app/analysis/cad_data.tsv"
def f(x):
    try: return float(x)
    except: return None
def wc_rate(wc): return 72.0 if "Kongsburg" in wc else 69.0

rows=[]
with open(PATH) as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        w,h=f(r["FlatWidth"]),f(r["FlatHeight"]); ups=f(r["Ups"]) or 1
        ir=f(r["InchesOfRule"]) or 0
        if not w or not h or w<=0 or h<=0: continue
        perim=2*(w+h); ratio=(ir/ups)/perim if perim else 0
        rows.append(dict(job=r["jobNumber"],wc=r["work_center_desc"],name=r["JobComponentName"],
            ir=ir,ups=ups,ratio=ratio,sheets=f(r["Sheets"]) or 0,
            cis=int(f(r["ComponentsInSubJob"]) or 1),
            setup_h=f(r["SetupHours"]) or 0,run_h=f(r["RunHours"]) or 0))

LO,HI=1.5,3.0
def new_bucket(rt): return "Simple" if rt<LO else ("Standard" if rt<HI else "Complex")
def cur_bucket(rt): return "Complex" if rt>3.0 else "Standard"   # current engine auto (never Simple)

# single-component sub-jobs with a real run
groups=defaultdict(lambda: dict(sheets=0.0,setup_h=0,run_h=0,cis=1,ir=0,ratio=0,wc=""))
for r in rows:
    g=groups[(r["job"],r["wc"])]
    g["sheets"]+=r["sheets"]; g["setup_h"]=r["setup_h"]; g["run_h"]=r["run_h"]
    g["cis"]=r["cis"]; g["ir"]=r["ir"]; g["ratio"]=r["ratio"]; g["wc"]=r["wc"]

jobs=[g for g in groups.values() if g["cis"]==1 and g["run_h"]>0 and g["sheets"]>0]
print(f"Single-component sub-jobs analyzed: {len(jobs)}")

def spot_cost(g, diff_fn, setup_map, speed, rate):
    diff=diff_fn(g["ratio"])
    runtime_min = g["ir"]*1.15*g["sheets"]/speed
    cad_hrs=(setup_map[diff]+runtime_min)/60
    return cad_hrs*rate

CUR_SETUP={"Simple":8,"Standard":25,"Complex":22}
NEW_SETUP={"Simple":20,"Standard":25,"Complex":22}

scenarios={
 "ACTUAL (machine rate $69/$72)": None,
 "A. SPOT current (cur-class, 650, setup 8/25/22, $138)": (cur_bucket,CUR_SETUP,650,138),
 "B. NEW class only (650, $138)":                          (new_bucket,CUR_SETUP,650,138),
 "C. NEW + speed 290 ($138)":                              (new_bucket,CUR_SETUP,290,138),
 "D. NEW + 290 + setup Simple->20 ($138)":                 (new_bucket,NEW_SETUP,290,138),
 "E. NEW + 290 + setup 20 + MACHINE rate $69/72":          (new_bucket,NEW_SETUP,290,None),
}

actual=[g["setup_h"]+g["run_h"] for g in jobs]                      # hrs
actual_cost=[(g["setup_h"]+g["run_h"])*wc_rate(g["wc"]) for g in jobs]
TOT_A=sum(actual_cost); TOT_AH=sum(actual)
print(f"\nTOTAL actual cutting hours: {TOT_AH:,.0f}    TOTAL actual cost (machine rate): ${TOT_A:,.0f}\n")
print(f"{'scenario':52}{'tot$':>12}{'vs actual':>10}{'medRatio':>10}{'MAPE%':>8}")
print(f"{'ACTUAL':52}{TOT_A:>12,.0f}{'1.00x':>10}{'--':>10}{'--':>8}")

for name,cfg in scenarios.items():
    if cfg is None: continue
    diff_fn,setup_map,speed,rate=cfg
    costs=[]
    for g in jobs:
        rr = rate if rate else wc_rate(g["wc"])
        costs.append(spot_cost(g,diff_fn,setup_map,speed,rr))
    tot=sum(costs)
    ratios=[c/a for c,a in zip(costs,actual_cost) if a>0]
    mape=st.mean([abs(c-a)/a for c,a in zip(costs,actual_cost) if a>0])*100
    print(f"{name:52}{tot:>12,.0f}{tot/TOT_A:>9.2f}x{st.median(ratios):>10.2f}{mape:>8.0f}")

# also pure HOURS parity (rate independent)
print("\nHOURS model parity (modeled cad_hrs / actual hrs, median):")
for name,cfg in scenarios.items():
    if cfg is None: continue
    diff_fn,setup_map,speed,rate=cfg
    rr=[]
    for g in jobs:
        diff=diff_fn(g["ratio"]); rt=g["ir"]*1.15*g["sheets"]/speed
        hrs=(setup_map[diff]+rt)/60; act=g["setup_h"]+g["run_h"]
        if act>0: rr.append(hrs/act)
    print(f"  {name:52} medianHrsRatio {st.median(rr):.2f}")
