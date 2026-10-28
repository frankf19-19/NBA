/* Evaluate immutable pre-tip forecasts only. Does not fit or alter predictions. */
'use strict';
const M=require('./margin-model'),C=require('./game-context');
const VERSION='forecast-audit-v1';
function build(entries,{version='quality-v1'}={}){
 const excluded={},rows=[],seen=new Set(),games=new Set();
 const reject=why=>{excluded[why]=(excluded[why]||0)+1;};
 for(const e of entries){
  const p=e?.pg;if(!p?.qv)continue;
  if(p.qv!==version){reject('otherVersion');continue;}
  if(e.po||e.nu||e.cf||e.st===1||e.nm||C.ledgerFlags(e).nu){reject('outsideRegularDomain');continue;}
  if(!Number.isFinite(e.am)||!e.am){reject('noFinalMargin');continue;}
  if(!/^\d{4}-\d\d-\d\d$/.test(e.d||'')||![e.hid,e.aid].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||e.hid===e.aid){reject('invalidGame');continue;}
  const tip=Date.parse(e.tip||p.tip),savedTip=Date.parse(p.tip||e.tip),at=Date.parse(p.at);
  if(!Number.isFinite(tip)||!Number.isFinite(savedTip)||!Number.isFinite(at)||at>=tip||at>=savedTip){reject('notVerifiedPregame');continue;}
  if(tip!==savedTip){reject('changedTip');continue;}
  if(!Number.isFinite(p.mm)||!Number.isFinite(p.baseMargin)){reject('missingPairedForecast');continue;}
  const key=e.d+'|'+e.hid+'|'+e.aid,id=String(e.id||key);
  if(seen.has(id)||games.has(key)){reject('duplicate');continue;}seen.add(id);games.add(key);
  const q=p.q,validQ=Array.isArray(q)&&q.length===12&&q.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(q.reduce((s,x)=>s+x,0)-1)<1e-6;
  const interval=p.interval,validInterval=interval&&Number.isFinite(interval.lo)&&Number.isFinite(interval.hi)&&interval.lo<=interval.hi&&Number.isFinite(interval.coverage)&&interval.coverage>0&&interval.coverage<1;
  rows.push({id,date:e.d,y:e.am,baseline:p.baseMargin,selected:p.mm,actualBin:M.actual(e.am),bin:Number.isInteger(p.mb)&&p.mb>=0&&p.mb<12?p.mb:null,q:validQ?q:null,interval:validInterval?interval:null});
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const metric=key=>rows.length?M.metrics(rows.map(r=>({y:r.y,base:r[key]}))):null;
 const probs=rows.filter(r=>r.q),bins=rows.filter(r=>r.bin!==null),ranges=rows.filter(r=>r.interval),dates=[...new Set(rows.map(r=>r.date))];
 const mean=(a,f)=>a.length?a.reduce((s,r)=>s+f(r),0)/a.length:null;
 return {schema:1,version:VERSION,forecastVersion:version,scope:'paired immutable pre-tip non-neutral regular-season forecasts; no automatic model selection',n:rows.length,dates:dates.length,from:dates[0]||null,through:dates.at(-1)||null,baseline:metric('baseline'),selected:metric('selected'),maeDifference:mean(rows,r=>Math.abs(r.y-r.selected)-Math.abs(r.y-r.baseline)),
  bins:{n:bins.length,hits:bins.filter(r=>r.bin===r.actualBin).length,accuracy:mean(bins,r=>+(r.bin===r.actualBin)),probabilityN:probs.length,brier:mean(probs,r=>r.q.reduce((s,p,k)=>s+(p- +(k===r.actualBin))**2,0)),logloss:mean(probs,r=>-Math.log(Math.max(1e-12,r.q[r.actualBin]))),missingOrInvalidProbabilities:rows.length-probs.length},
  intervals:{n:ranges.length,coverage:mean(ranges,r=>+(r.y>=r.interval.lo&&r.y<=r.interval.hi)),nominal:mean(ranges,r=>r.interval.coverage),meanWidth:mean(ranges,r=>r.interval.hi-r.interval.lo)},
  excluded,automaticPromotion:false,warning:dates.length<20?'Fewer than 20 distinct game dates; descriptive only, no reliable improvement claim.':'Observed performance only; no automatic model promotion.'};
}
module.exports={VERSION,build};
