'use strict';
const M=require('./margin-model'),C=require('./game-context');
const validQ=q=>Array.isArray(q)&&q.length===12&&q.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(q.reduce((s,x)=>s+x,0)-1)<1e-6;
function build(entries,archive){
 const pairs=[],seen=new Set(),seenGame=new Set(),observations=archive?.schema===1&&archive.version==='pregame-observations-v1'&&Array.isArray(archive.observations)?archive.observations:[];
 for(const e of entries){
  if(!e||e.po||e.nu||e.cf||e.nm||(e.st!=null&&e.st!==2)||C.ledgerFlags(e).nu||!Number.isFinite(e.am)||!e.am||!e.id)continue;
  const tip=Date.parse(e.tip||e.pg?.tip);if(!Number.isFinite(tip))continue;
  const eligible=observations.filter(r=>r.id===String(e.id)&&r.date===e.d&&r.homeId===e.hid&&r.awayId===e.aid&&Date.parse(r.tip)===tip&&Number.isFinite(r.margin)&&Number.isFinite(Date.parse(r.at))&&Number.isFinite(Date.parse(r.savedAt))&&Date.parse(r.at)<=Date.parse(r.savedAt)&&Date.parse(r.savedAt)<tip).map(r=>({r,lead:(tip-Date.parse(r.savedAt))/6e4}));
  const latest=(lo,hi,inclusive=false)=>eligible.filter(v=>(inclusive?v.lead>=lo:v.lead>lo)&&v.lead<=hi).sort((a,b)=>Date.parse(b.r.savedAt)-Date.parse(a.r.savedAt))[0];
  const early=latest(120,360,true),near=latest(0,60);
  if(!early||!near||early.r.qualityVersion!==near.r.qualityVersion||early.r.qualityName!==near.r.qualityName)continue;
  const key=e.d+'|'+e.hid+'|'+e.aid;if(seen.has(String(e.id))||seenGame.has(key))continue;seen.add(String(e.id));seenGame.add(key);pairs.push({e,early,near});
 }
 const metrics=key=>pairs.length?M.metrics(pairs.map(p=>({y:p.e.am,base:p[key].r.margin}))):null;
 const probabilityPairs=pairs.filter(p=>validQ(p.early.r.probabilities)&&validQ(p.near.r.probabilities));
 const probabilityMetrics=key=>probabilityPairs.length?M.metrics(probabilityPairs.map(p=>({y:p.e.am,base:p[key].r.margin})),probabilityPairs.map(p=>p[key].r.probabilities)):null;
 const dates=[...new Set(pairs.map(p=>p.e.d))].sort();
 return {schema:1,version:'pregame-timing-audit-v1',scope:'Latest saved snapshot 2-6h before tip versus latest within1h; same game and model version; observational only',observations:observations.length,n:pairs.length,dates:dates.length,from:dates[0]||null,through:dates.at(-1)||null,early:metrics('early'),near:metrics('near'),probabilityPairs:probabilityPairs.length,earlyProbability:probabilityMetrics('early'),nearProbability:probabilityMetrics('near'),pairs:pairs.map(p=>({id:String(p.e.id),date:p.e.d,earlySavedAt:p.early.r.savedAt,nearSavedAt:p.near.r.savedAt,earlyLeadMinutes:p.early.lead,nearLeadMinutes:p.near.lead})),automaticPromotion:false,warning:dates.length<20?'Fewer than20 distinct completed dates; no reliable improvement claim.':'Descriptive association only; not proof that injury updates caused a change.'};
}
module.exports={build};
