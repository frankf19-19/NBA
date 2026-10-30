/* Locked prospective role candidate. Research only; never changes the formal forecast. */
'use strict';
const crypto=require('crypto'),M=require('./margin-model'),Q=require('./quality-model'),C=require('./game-context');
const VERSION='role-study-v1',FEATURES='role-study-features-v1',seasonOf=d=>+d.slice(0,4)+(+d.slice(5,7)>=8?1:0),finite=Number.isFinite;
function parameters(model){
 if(!model||model.schema!==1||model.version!==VERSION||model.mode!=='shadow'||model.pointEnabled!==false||typeof model.parametersText!=='string'||crypto.createHash('sha256').update(model.parametersText).digest('hex')!==model.modelId)return null;
 try{const p=JSON.parse(model.parametersText);return p.season===2027&&p.featureVersion===FEATURES&&JSON.stringify(p.coreColumns)==='[0,2,3,4,5,14,15,16]'&&Array.isArray(p.coefficients)&&p.coefficients.length===20&&p.coefficients.every(finite)&&finite(Date.parse(p.lockedAt))&&p.trainThrough<p.eligibleFromDate?p:null;}catch(e){return null;}
}
function pair(v){const a=String(v).split('-').map(Number);return a.length===2&&a.every(finite)?a:[0,0];}
function box(g,side){
 const b=g.bx?.[side],out=[];if(!b?.lb||!Array.isArray(b.p))return null;
 for(const p of b.p){if(p.length<4||p[2])continue;const row={id:String(p[0]),starter:!!p[1]};for(const k of ['MIN','PTS','AST','REB','TO','OREB','DREB','FG','3PT','FT']){const i=b.lb.indexOf(k);row[k]=i>=0&&i+3<p.length?p[i+3]:0;}if(!['MIN','PTS','AST','REB','TO','OREB','DREB'].every(k=>finite(row[k])))return null;out.push(row);}
 const minutes=out.reduce((s,p)=>s+p.MIN,0),points=out.reduce((s,p)=>s+p.PTS,0);return out.length>=5&&minutes>=180&&minutes<=350&&points===g[side==='h'?'hs':'as']?out:null;
}
function aggregate(hist){const out=new Map();for(const ps of hist)for(const p of ps){const x=out.get(p.id)||Array(6).fill(0),v=[p.MIN,pair(p.FG)[1]+.44*pair(p.FT)[1]+p.TO,p.AST,p.PTS,p.TO,1];v.forEach((a,k)=>x[k]+=a);out.set(p.id,x);}return out;}
function role(hist){
 const old=aggregate(hist.slice(0,-3)),recent=aggregate(hist.slice(-3)),ids=[...new Set([...old.keys(),...recent.keys()])].sort(),A=ids.map(id=>old.get(id)||Array(6).fill(0)),B=ids.map(id=>recent.get(id)||Array(6).fill(0)),sum=rows=>Array.from({length:6},(_,k)=>rows.reduce((s,r)=>s+r[k],0)),ta=sum(A),tb=sum(B),total=ta.map((v,k)=>v+tb[k]),f=Array(10).fill(0);
 for(let i=0;i<ids.length;i++){const a=A[i],b=B[i],sa=a.slice(0,3).map((v,k)=>v/Math.max(1,ta[k])),sb=b.slice(0,3).map((v,k)=>v/Math.max(1,tb[k]));[1,2,3].forEach((c,k)=>f[k]+=((a[c]+b[c])/Math.max(1,total[c]))**2);for(let k=0;k<3;k++)f[3+k]+=Math.abs(sb[k]-sa[k]);const d=sb[0]-sa[0];for(let k=0;k<3;k++){const c=[3,2,4][k];f[6+k]+=d*(a[c]+60*ta[c]/Math.max(1,ta[0]))/(a[0]+60);}f[9]+=sb[0]*(a[3]+30*ta[3]/Math.max(1,ta[1]))/(a[1]+30);}
 return f;
}
function roleVector(histories){const ok=histories.map(h=>h.length>=6),values=histories.map((h,k)=>ok[k]?role(h):Array(10).fill(0));return [...values[0].map((v,k)=>ok.every(Boolean)?v-values[1][k]:0),...ok.map(Number)];}
function prepare(entries,through,season){
 const cutoff=new Date(Date.parse(through+'T12:00:00Z')+864e5).toISOString().slice(0,10),rows=M.clean(entries,cutoff).filter(e=>e.sy>=season-1&&e.sy<=season),empty=()=>Array.from({length:31},()=>[]);let current=empty(),previous=empty(),sy=null;
 for(const e of rows){if(sy!==e.sy){previous=current;current=empty();sy=e.sy;}const h=box(e,'h'),a=box(e,'a');if(h&&a){current[e.hid].push(h);current[e.aid].push(a);}}
 if(sy!==season){previous=current;current=empty();}return {through,season,histories:Array.from({length:31},(_,t)=>(current[t].length>=6?current[t]:previous[t]).slice(-10))};
}
function forecast(model,quality,state,g,f,pg,date,{savedAt=new Date().toISOString()}={}){
 const p=parameters(model),saved=Date.parse(savedAt),at=Date.parse(pg?.at),tip=Date.parse(g?.startISO);
 if(!p||!finite(saved)||!finite(at)||!finite(tip)||at>saved||saved>=tip||at<Date.parse(p.lockedAt)||date<p.eligibleFromDate||seasonOf(date)!==p.season||g.stype!==2||g.neutralSite||g.cupFinal||C.ledgerFlags({id:g.id}).nu||![g.homeId,g.awayId].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||g.homeId===g.awayId||pg.qv!=='quality-v1'||pg.qn!=='regress3'||!finite(pg.mm)||!finite(pg.baseMargin)||!finite(pg.ih)||!finite(pg.ia)||Date.parse(pg.tip)!==tip||!Q.valid(quality,date)||quality.selection?.name!=='regress3'||state?.through!==quality.trainedThrough||state.season!==p.season||!f||!finite(f.b)||!Array.isArray(f.x)||f.x.length!==7||!f.x.every(finite))return null;
 if(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(tip))!==date)return null;
 try{const s=JSON.parse(JSON.stringify(quality.state));if(s.season!==p.season)Q.newSeason(s,p.season,date);const core=Q.vector(s,{hid:g.homeId,aid:g.awayId,d:date,sy:p.season,f}),features=[...p.coreColumns.map(k=>core[k]),...roleVector([state.histories[g.homeId],state.histories[g.awayId]])];if(!features.every(finite))return null;const point=features.reduce((v,x,k)=>v+x*p.coefficients[k],0),injury=pg.ih-pg.ia;return {key:String(g.id)+'|'+pg.at+'|'+model.modelId,id:String(g.id),date,season:p.season,homeId:g.homeId,awayId:g.awayId,tip:g.startISO,at:pg.at,savedAt,modelId:model.modelId,lockedAt:p.lockedAt,version:VERSION,formalVersion:pg.qv,formalName:pg.qn,formal:pg.mm,baseline:pg.baseMargin,candidate:point+injury,pointOnly:point,injury,through:quality.trainedThrough,roleSampleSizes:[state.histories[g.homeId].length,state.histories[g.awayId].length]};}catch(e){return null;}
}
function append(archive,record){if(!record)return archive;if(archive!=null&&(archive.schema!==1||archive.version!==VERSION||archive.modelId!==record.modelId||archive.season!==record.season||!Array.isArray(archive.observations)))throw Error('Invalid role archive; preserve file');if(archive?.observations.some(r=>r.key===record.key))return archive;return {schema:1,version:VERSION,modelId:record.modelId,season:record.season,observations:[...(archive?.observations||[]),JSON.parse(JSON.stringify(record))]};}
function score(entries,archive){
 const rows=[],seen=new Set();if(archive?.schema===1&&archive.version===VERSION&&Array.isArray(archive.observations))for(const e of entries){const p=e.pg;if(!p||e.po||e.nu||e.cf||e.nm||e.st!==2||C.ledgerFlags(e).nu||!finite(e.am)||!e.am||seen.has(String(e.id)))continue;const r=archive.observations.find(r=>r.version===VERSION&&r.season===archive.season&&r.season===seasonOf(e.d)&&r.id===String(e.id)&&r.at===p.at&&r.modelId===archive.modelId&&r.date===e.d&&r.homeId===e.hid&&r.awayId===e.aid&&Date.parse(r.tip)===Date.parse(e.tip||p.tip)&&Date.parse(r.tip)===Date.parse(p.tip)&&Date.parse(r.lockedAt)<=Date.parse(r.at)&&Date.parse(r.at)<=Date.parse(r.savedAt)&&Date.parse(r.savedAt)<Date.parse(r.tip)&&r.formalVersion==='quality-v1'&&r.formalName==='regress3'&&r.formalVersion===p.qv&&r.formalName===p.qn&&r.formal===p.mm&&r.baseline===p.baseMargin&&[r.candidate,r.formal,r.baseline].every(finite));if(!r)continue;seen.add(String(e.id));rows.push({...r,y:e.am});}
 const met=k=>rows.length?M.metrics(rows.map(r=>({y:r.y,base:r[k]}))):null;return {schema:1,version:VERSION,modelId:archive?.modelId||null,observations:archive?.observations?.length||0,n:rows.length,dates:new Set(rows.map(r=>r.date)).size,formal:met('formal'),baseline:met('baseline'),candidate:met('candidate'),automaticPromotion:false,warning:'Prospective paired records only. Fewer than60dates/600games cannot support promotion; no automatic selection.'};
}
module.exports={VERSION,parameters,box,role,roleVector,prepare,forecast,append,score};
