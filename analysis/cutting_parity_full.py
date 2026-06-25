"""
Definitive cutting parity on 662 real WF-Corrugated jobs (2yr, 3 CAD work centers).
ActualCuttingCost = real $ from cutting work centers (= actual hrs x ~$69-72/hr).

We compare SPOT's modeled cutting $ (engine formula) to ActualCuttingCost, and
regress what actually drives real cutting cost (inches vs per-sheet handling).
"""
import openpyxl, statistics as st
import numpy as np

wb=openpyxl.load_workbook('/app/analysis/cutting.xlsx', read_only=True, data_only=True)
ws=wb.active
it=ws.iter_rows(values_only=True); H=list(next(it))
idx={h:i for i,h in enumerate(H)}
def col(r,name): return r[idx[name]]

J=[]
for r in it:
    try:
        fw=float(col(r,'FinishedWidth')); fl=float(col(r,'FinishedLength'))
        nu=float(col(r,'NumberUp')); ir=float(col(r,'CuttingInchesPerSheet'))
        sh=float(col(r,'ActualSheets')); cost=float(col(r,'ActualCuttingCost'))
    except (TypeError,ValueError): continue
    if min(fw,fl,nu,ir,sh)<=0 or cost<=0: continue
    perim=2*(fw+fl); ratio=(ir/nu)/perim
    J.append(dict(ir=ir,nu=nu,sh=sh,cost=cost,ratio=ratio,erp=col(r,'ComplexityOfCut'),
                  tot_in=ir*sh))           # total rule inches cut over the run (no 1.15)
print(f"Jobs analyzed: {len(J)}   total actual cutting $ = {sum(j['cost'] for j in J):,.0f}")

LO,HI=1.5,3.0
def newb(rt): return "Simple" if rt<LO else ("Standard" if rt<HI else "Complex")
def curb(rt): return "Complex" if rt>3.0 else "Standard"
CUR_SETUP={"Simple":8,"Standard":25,"Complex":22}; NEW_SETUP={"Simple":20,"Standard":25,"Complex":22}

def spot(j,bfn,smap,speed,rate):
    rt=j['ir']*1.15*j['sh']/speed
    return (smap[bfn(j['ratio'])]+rt)/60*rate

TOT=sum(j['cost'] for j in J)
def report(name,bfn,smap,speed,rate):
    cs=[spot(j,bfn,smap,speed,rate) for j in J]
    tot=sum(cs); ratios=[c/j['cost'] for c,j in zip(cs,J)]
    mape=st.mean([abs(c-j['cost'])/j['cost'] for c,j in zip(cs,J)])*100
    print(f"  {name:48}{tot:>12,.0f}{tot/TOT:>8.2f}x{st.median(ratios):>9.2f}{mape:>8.0f}")

print(f"\n  {'scenario':48}{'tot$':>12}{'vsAct':>8}{'medR':>9}{'MAPE%':>8}")
print(f"  {'ACTUAL':48}{TOT:>12,.0f}{'1.00x':>8}{'--':>9}{'--':>8}")
report("SPOT current (cur-class,650,8/25/22,$138)",curb,CUR_SETUP,650,138)
report("NEW class (650,$138)",newb,CUR_SETUP,650,138)
report("NEW + speed 290 ($138)",newb,CUR_SETUP,290,138)
report("NEW + 290 + Simple-setup 20 ($138)",newb,NEW_SETUP,290,138)
report("KEEP 650/$138, setup flat 50min (cur-class)",curb,{"Simple":50,"Standard":50,"Complex":50},650,138)
report("KEEP 650/$138, setup 45/55/55 (new-class)",newb,{"Simple":45,"Standard":55,"Complex":55},650,138)

# ---- what REALLY drives actual cutting cost? ----
print("\n" + "="*64)
print("REGRESSION of ActualCuttingCost (least squares)")
tin=np.array([j['tot_in'] for j in J]); sh=np.array([j['sh'] for j in J])
y=np.array([j['cost'] for j in J]); n=len(y)
def fit(X,labels):
    beta,_,_,_=np.linalg.lstsq(X,y,rcond=None)
    pred=X@beta; ss_res=((y-pred)**2).sum(); ss_tot=((y-y.mean())**2).sum()
    r2=1-ss_res/ss_tot
    mape=np.mean(np.abs(pred-y)/y)*100
    print(f"  model: {' + '.join(labels)}")
    for l,b in zip(labels,beta): print(f"      {l:18} = {b:.5f}")
    print(f"      R2 = {r2:.3f}   MAPE = {mape:.0f}%")
    return beta
print("\n[A] cost = a + b*total_inches   (SPOT's inches-only shape)")
b1=fit(np.column_stack([np.ones(n),tin]),["intercept","$/inch"])
print("\n[B] cost = a + b*total_inches + c*sheets   (adds per-sheet handling)")
b2=fit(np.column_stack([np.ones(n),tin,sh]),["intercept","$/inch","$/sheet"])
pcs=np.array([j['nu']*j['sh'] for j in J])
print("\n[C] cost = a + b*total_inches + c*sheets + d*pieces")
fit(np.column_stack([np.ones(n),tin,sh,pcs]),["intercept","$/inch","$/sheet","$/piece"])
# multiplicative (log) fit — better for skewed cost data
print("\n[D] log-log: ln(cost) = a + b*ln(total_inches)")
ly=np.log(y); lx=np.log(tin)
bb,_,_,_=np.linalg.lstsq(np.column_stack([np.ones(n),lx]),ly,rcond=None)
pred=np.exp(np.column_stack([np.ones(n),lx])@bb)
print(f"      exponent={bb[1]:.3f}  median |%err|={np.median(np.abs(pred-y)/y)*100:.0f}%")

# translate model B to physical terms at $70/hr blended machine rate
rate=70.0
print(f"\n  Interpreting model B at ~${rate}/hr machine rate:")
print(f"    fixed setup    ~ {b2[0]/rate*60:5.1f} min/job")
print(f"    per-sheet load ~ {b2[2]/rate*60:5.2f} min/sheet")
print(f"    cut speed      ~ {rate/60/b2[1]:5.0f} in/min (effective, incl no handling)")
