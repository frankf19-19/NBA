/* Prospective probability research only. Never changes the formal margin or bins. */
'use strict';
const M=require('./margin-model'),C=require('./game-context');
const VERSION='bin-factor-shadow-v1',seasonOf=d=>+d.slice(0,4)+(+d.slice(5,7)>=8?1:0);
const validQ=q=>Array.isArray(q)&&q.length===12&&q.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(q.reduce((s,x)=>s+x,0)-1)<1e-6;
function forecast(model,g,margin,date,q,{at=new Date().toISOString(),pointVersion}={}){
 if(!model||model.schema!==1||model.version!==VERSION||model.mode!=='shadow'||model.pointEnabled!==false||model.automaticPromotion!==false||model.method!=='halfFactorized'||model.weight!==.5||model.grid?.step!==.25||!Array.isArray(model.grid.probabilities)||model.grid.probabilities.length!==161||!/^\d{4}-\d\d-\d\d$/.test(date||'')||model.season!==seasonOf(date)||!/^\d{4}-\d\d-\d\d$/.test(model.trainedThrough||'')||model.trainedThrough>=date||seasonOf(model.trainedThrough)>=model.season||!Number.isFinite(margin)||!validQ(q)||pointVersion!=='quality-v1'||!g?.id||![g.homeId,g.awayId].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||g.homeId===g.awayId||g.neutralSite||g.cupFinal||g.stype!==2||C.ledgerFlags({id:g.id}).nu||!Number.isFinite(Date.parse(at))||!Number.isFinite(Date.parse(g.startISO))||Date.parse(at)>=Date.parse(g.startISO))return null;
 const x=Math.min(160,Math.abs(margin)/.25),lo=Math.floor(x),hi=Math.min(160,lo+1),a=x-lo,L=model.grid.probabilities[lo],H=model.grid.probabilities[hi];
 if(!validQ(L)||!validQ(H))return null;
 let f=L.map((v,k)=>v*(1-a)+H[k]*a);if(margin<0)f=f.slice(6).concat(f.slice(0,6));
 const probabilities=q.map((v,k)=>(v+f[k])/2),sum=probabilities.reduce((s,v)=>s+v,0);
 return {version:VERSION,mode:'shadow',pointEnabled:false,method:model.method,season:model.season,trainedThrough:model.trainedThrough,gid:String(g.id),date,tip:g.startISO,at,pointVersion,margin,baseline:q.slice(),probabilities:probabilities.map(v=>v/sum)};
}
function score(entries){
 const rows=[],seen=new Set(),games=new Set();
 for(const e of entries){const pg=e?.pg,a=pg?.binShadow;
  if(!e||!/^\d{4}-\d\d-\d\d$/.test(e.d||'')||![e.hid,e.aid].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||e.hid===e.aid)continue;
  if(!a||a.version!==VERSION||a.mode!=='shadow'||a.pointEnabled!==false||a.method!=='halfFactorized'||a.pointVersion!=='quality-v1'||pg.qv!==a.pointVersion||e.po||e.nu||e.cf||e.nm||(e.st!=null&&e.st!==2)||C.ledgerFlags(e).nu||!Number.isFinite(e.am)||!e.am||!Number.isFinite(pg.mm)||a.margin!==pg.mm||String(e.id)!==a.gid||e.d!==a.date||a.season!==seasonOf(e.d)||!/^\d{4}-\d\d-\d\d$/.test(a.trainedThrough||'')||a.trainedThrough>=e.d||seasonOf(a.trainedThrough)>=a.season||!validQ(a.baseline)||!validQ(a.probabilities)||!validQ(pg.q)||a.baseline.some((v,k)=>Math.abs(v-pg.q[k])>1e-12))continue;
  const tip=Date.parse(e.tip||pg.tip),savedTip=Date.parse(a.tip),at=Date.parse(a.at),pgAt=Date.parse(pg.at);
  if(![tip,savedTip,at,pgAt].every(Number.isFinite)||tip!==savedTip||Date.parse(pg.tip||e.tip)!==tip||at>=tip||pgAt>=tip)continue;
  const key=e.d+'|'+e.hid+'|'+e.aid;if(seen.has(a.gid)||games.has(key))continue;seen.add(a.gid);games.add(key);rows.push({e,a});
 }
 const met=key=>{if(!rows.length)return null;let hits=0,ll=0,bs=0;for(const {e,a} of rows){const c=M.actual(e.am),q=a[key];hits+=q.indexOf(Math.max(...q))===c;ll-=Math.log(Math.max(1e-12,q[c]));bs+=q.reduce((s,v,k)=>s+(v- +(k===c))**2,0);}return {n:rows.length,hits,accuracy:hits/rows.length,logloss:ll/rows.length,brier:bs/rows.length};};
 return {n:rows.length,dates:new Set(rows.map(r=>r.e.d)).size,baseline:met('baseline'),shadow:met('probabilities'),automaticPromotion:false};
}
module.exports={VERSION,validQ,forecast,score};
