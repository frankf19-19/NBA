/* Append-only prospective observations. Never trains or changes predictions. */
'use strict';
const C=require('./game-context');
const VERSION='pregame-observations-v1';
const seasonOf=d=>+d.slice(0,4)+(+d.slice(5,7)>=8?1:0);
const validQ=q=>Array.isArray(q)&&q.length===12&&q.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(q.reduce((s,x)=>s+x,0)-1)<1e-6;
function append(history,g,pg,date,{savedAt=new Date().toISOString()}={}){
 if(!/^\d{4}-\d\d-\d\d$/.test(date||'')||!g||g.stype!==2||g.neutralSite||g.cupFinal||C.ledgerFlags({id:g.id}).nu||!g.id||![g.homeId,g.awayId].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||g.homeId===g.awayId||!pg||!Number.isFinite(pg.mm))return null;
 const at=Date.parse(pg.at),saved=Date.parse(savedAt),tip=Date.parse(g.startISO);
 if(![at,saved,tip].every(Number.isFinite)||at>saved||saved>=tip||Date.parse(pg.tip)!==tip||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(tip))!==date)return null;
 const season=seasonOf(date);
 if(history!==null&&history!==undefined&&(history.schema!==1||history.version!==VERSION||history.season!==season||!Array.isArray(history.observations)))throw Error('Invalid observation archive; preserve existing file');
 const records=history?.observations||[],id=String(g.id),key=id+'|'+pg.at;
 if(records.some(r=>r.key===key))return history;
 let source=null,sourceIssue=null;
 if(pg.injOfficial){const published=Date.parse(pg.injOfficial.publishedAt),url=pg.injOfficial.url;
  if(Number.isFinite(published)&&published<=at&&typeof url==='string'&&/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\//.test(url))source={publishedAt:pg.injOfficial.publishedAt,url};else sourceIssue='Invalid or future official source';
 }
 const record={key,id,date,season,homeId:g.homeId,awayId:g.awayId,tip:g.startISO,at:pg.at,savedAt,margin:pg.mm,baselineMargin:Number.isFinite(pg.baseMargin)?pg.baseMargin:null,qualityVersion:pg.qv||null,qualityName:pg.qn||null,probabilities:validQ(pg.q)?pg.q.slice():null,bin:Number.isInteger(pg.mb)&&pg.mb>=0&&pg.mb<12?pg.mb:null,injury:{home:Number.isFinite(pg.ih)?pg.ih:null,away:Number.isFinite(pg.ia)?pg.ia:null,factor:Number.isFinite(pg.f)?pg.f:null,source,sourceIssue}};
 return {schema:1,version:VERSION,season,scope:'Actual contemporaneous pre-tip snapshots; no retrospective backfill; no training or automatic promotion',observations:records.concat(record)};
}
module.exports={VERSION,append};
