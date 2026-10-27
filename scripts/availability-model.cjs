/* Official-report nonappearance probabilities: research only, never point adjustments. */
'use strict';
const Context=require('./game-context');
const VERSION='availability-shadow-v1',FIXED=Object.freeze({Out:1,Doubtful:.75,Questionable:.4,Probable:.1,Available:0});
const ET=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const tipMinutes=t=>{const p=Object.fromEntries(ET.formatToParts(t).map(x=>[x.type,x.value]));return +p.hour*60+(+p.minute);};
const seasonOf=d=>+d.slice(0,4)+(+d.slice(5,7)>=8?1:0);
function validDate(d){return typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00Z'))&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;}
function stats(entries,date){
 if(!validDate(date))return {};const season=seasonOf(date),data={},seen=new Set();
 for(const e of entries){if(!e||!validDate(e.d))continue;const sy=e.sy||seasonOf(e.d);if(!e||!validDate(e.d)||e.d>=date||sy<season-1||sy>season||e.po||e.st===1||!Number.isFinite(e.am)||!e.am||Context.ledgerFlags(e).cf)continue;
  const key=e.id||e.d+'|'+e.hid+'|'+e.aid;if(seen.has(key))continue;seen.add(key);const players=new Set();
  for(const side of ['h','a'])for(const p of Array.isArray(e.pl?.[side])?e.pl[side]:[]){const id=+p.id,min=+p.min,pts=+(p.pts||0);if(!Number.isInteger(id)||id<=0||!(min>=0)||!Number.isFinite(pts)||players.has(id))continue;players.add(id);const v=(data[id]??={})[sy]??={gp:0,pts:0,min:0};v.gp++;v.pts+=pts;v.min+=min;}
 }
 const out={};for(const [id,years] of Object.entries(data)){const cur=years[season],prev=years[season-1],v=cur?.gp>=5?cur:prev?.gp>=8?prev:null;if(v)out[id]={ppg:v.pts/v.gp,mpg:Math.min(48,v.min/v.gp),gp:v.gp,statSeason:v===cur?season:season-1};}return out;
}
function savedUsable(s,g,date){
 if(g.neutralSite||g.cupFinal||(g.stype!=null&&g.stype!==2)||!validDate(date)||!s||s.season!==seasonOf(date)||!(s.trainedThrough<date)||s.version!==VERSION||s.mode!=='shadow'||s.pointEnabled!==false||s.gid!==String(g.id)||s.date!==date||Date.parse(s.tip)!==Date.parse(g.startISO)||!Array.isArray(s.rows)||!s.rows.length)return false;
 const at=Date.parse(s.at),tip=Date.parse(s.tip),pub=Date.parse(s.publishedAt),age=(tip-pub)/36e5;
 return Number.isFinite(at)&&Number.isFinite(tip)&&Number.isFinite(pub)&&tipMinutes(tip)>=1050&&tipMinutes(tip)<=1380&&pub<=at&&at<tip&&age>=.5&&age<=6&&s.rows.every(r=>Number.isInteger(r.pid)&&r.pid>0&&[g.homeId,g.awayId].includes(r.tid)&&Object.hasOwn(FIXED,r.status)&&Number.isFinite(r.probability)&&r.probability>=0&&r.probability<=1&&['statusAge','statusRole'].every(k=>Number.isFinite(r.alternatives?.[k])&&r.alternatives[k]>=0&&r.alternatives[k]<=1)&&r.fixedProxy===FIXED[r.status]);
}
function forecast(model,g,date,official,injuries,profiles,now=Date.now()){
 try{
  if(!g||g.neutralSite||g.cupFinal||(g.stype!=null&&g.stype!==2)||g.id==null||![g.homeId,g.awayId].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||g.homeId===g.awayId||!model||model.schema!==1||model.version!==VERSION||model.method!=='statusBeta50'||model.mode!=='shadow'||model.pointEnabled!==false||!validDate(date)||model.season!==seasonOf(date)||!(model.trainedThrough<date)||!Array.isArray(model.trainingSeasons)||model.trainingSeasons.length!==2||Math.max(...model.trainingSeasons)>=model.season||official?.pv!==3)return null;
  const u=new URL(official.url);if(u.protocol!=='https:'||u.hostname!=='ak-static.cms.nba.com')return null;
  const tip=Date.parse(g.startISO),pub=Date.parse(official.publishedAt),age=(tip-pub)/36e5,c=model.config;if(!Number.isFinite(tip)||!Number.isFinite(pub)||pub>now||now>=tip||age<c.minReportAgeHours||age>c.maxReportAgeHours)return null;
  if(c.minReportAgeHours!==.5||c.maxReportAgeHours!==6||c.minPPG!==6||c.minMPG!==10||c.rolePPG!==15||c.minTipETMinutes!==1050||c.maxTipETMinutes!==1380)return null;
  if(tipMinutes(tip)<c.minTipETMinutes||tipMinutes(tip)>c.maxTipETMinutes)return null;
  const rows=[],seen=new Set();for(const tid of [g.homeId,g.awayId])for(const x of injuries[tid]||[]){const id=+x.id,p=profiles[id];if(!x.off||!Number.isInteger(id)||id<=0||!Object.hasOwn(FIXED,x.status)||!p||!Number.isFinite(p.ppg)||!Number.isFinite(p.mpg)||p.ppg<c.minPPG||p.mpg<c.minMPG||seen.has(id))continue;
   const role=+(p.ppg>=c.rolePPG),ageGroup=age<=1?0:age<=3?1:2,prob=model.status[x.status]?.probability,alternatives={statusAge:model.ageTable[x.status+'|'+ageGroup]?.probability,statusRole:model.table[x.status+'|'+role]?.probability};if(![prob,...Object.values(alternatives)].every(v=>Number.isFinite(v)&&v>=0&&v<=1))return null;
   seen.add(id);rows.push({pid:id,tid,status:x.status,ppg:p.ppg,mpg:p.mpg,gp:p.gp,statSeason:p.statSeason,probability:prob,alternatives,fixedProxy:FIXED[x.status],role});
  }
  if(!rows.length)return null;const s={version:VERSION,season:model.season,trainedThrough:model.trainedThrough,method:model.method,mode:'shadow',pointEnabled:false,gid:String(g.id),date,tip:g.startISO,at:new Date(now).toISOString(),publishedAt:official.publishedAt,url:official.url,rows};return savedUsable(s,g,date)?s:null;
 }catch(e){return null;}
}
function score(entries){
 const values=[],games=new Set(),seen=new Set();for(const e of entries){if(!e)continue;const s=e.pg?.availabilityShadow,tip=e.tip||e.pg?.tip||s?.tip;if(e.nu||e.cf||e.po||!Number.isFinite(e.am)||!e.am||!s||!Array.isArray(e.pl?.h)||!e.pl.h.length||!Array.isArray(e.pl?.a)||!e.pl.a.length||!(Date.parse(e.pg.at)<Date.parse(tip))||!savedUsable(s,{id:e.id,startISO:s.tip,homeId:e.hid,awayId:e.aid},e.d)||!(Date.parse(s.at)<Date.parse(tip)))continue;
  const reportGap=(Date.parse(tip)-Date.parse(s.publishedAt))/36e5;if(!(reportGap>=.5&&reportGap<=6))continue;
  for(const r of s.rows){const key=e.id+'|'+r.pid;if(seen.has(key))continue;seen.add(key);const list=e.pl[r.tid===e.hid?'h':'a'],out=list.some(p=>+p.id===r.pid)?0:1;values.push([out,r.fixedProxy,r.probability,r.alternatives.statusAge,r.alternatives.statusRole]);games.add(e.id);}
 }
 const metric=k=>values.length?{brier:values.reduce((n,r)=>n+(r[0]-r[k])**2,0)/values.length,logloss:values.reduce((n,r)=>{const p=Math.max(1e-6,Math.min(1-1e-6,r[k]));return n-r[0]*Math.log(p)-(1-r[0])*Math.log(1-p);},0)/values.length}:null;
 return {n:values.length,games:games.size,fixedProxy:metric(1),model:metric(2),alternatives:{statusAge:metric(3),statusRole:metric(4)},automaticPromotion:false};
}
module.exports={VERSION,FIXED,stats,savedUsable,forecast,score};
