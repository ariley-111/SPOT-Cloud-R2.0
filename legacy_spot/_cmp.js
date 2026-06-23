const E = require('./spot_engine.js');
const boardSpec = { boardGrade:"200", flute:"E", outsideLiner:"None", insideLiner:"None", medium:"None", gradeAdder:0, fscEnabled:false };
const asmp = { cadDifficulty:"Standard", crestComplexity:"Standard", printReq:"Yes", printMode:"Satin", printSides:"1-Sided" };
const opts = { printReq:"Yes", printMode:"Satin", printSides:"1-Sided", crestComplexity:"Standard", dieTreatment:"None" };
const W=28.625, L=25.5, Q=515;

const rc = E.compareRoutes(W,L,boardSpec,Q,asmp,opts);
if(!rc){ console.log("compareRoutes -> NULL"); process.exit(0);}
const f=(o,k)=>o&&o[k]!=null?(+o[k]).toFixed(2):"-";
for(const k of ["cad","crest","bobst"]){
  const v=rc[k]; if(!v){console.log(k.toUpperCase(),"= null");continue;}
  console.log(k.toUpperCase(),"board="+f(v,"board"),"press="+f(v,"press"),"cut="+f(v,"cut"),"die="+(v.die!=null?v.die:"-"),"total="+f(v,"total"),"req="+v.req,"pps="+v.pps,"millMin="+(v.isMillMinScaled||false),"minBuy="+(v.minBuySheets||"-"));
}
console.log("delta(crest-cad)=",(+rc.delta).toFixed(2));
console.log("winner=",rc.winner,"breakeven qty=",rc.breakeven.qty,"die=",(+rc.breakeven.die).toFixed(2));
console.log("perPc=",(+rc.perPc).toFixed(4),"bobstReason=",rc.bobstReason);
