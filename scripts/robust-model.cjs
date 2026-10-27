/* Experimental point forecasts: cloud shadow records only. Never enables itself. */
'use strict';
const M=require('./margin-model'),Q=require('./quality-model');
const VERSION='robust-shadow-v1',NAMES=['cap15','smooth20','earlyFast','gapDecay90','pace100','allShotsCap20'],RATES=[.04,.08,.12];
const zeros=n=>Array(n).fill(0),cube=()=>NAMES.map(()=>RATES.map(()=>zeros(31))),days=(a,b)=>(Date.parse(b+'T12:00Z')-Date.parse(a+'T12:00Z'))/864e5,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function initial(){return {season:null,ratings:cube(),games:zeros(31),last:{}};}
function prepare(s,season,date,teams){
 if(s.season!==season){s.ratings.forEach(A=>A.forEach(r=>r.forEach((v,t)=>r[t]=v*.65)));s.games=zeros(31);s.last={};s.season=season;}
 for(const tid of new Set(teams)){const gap=s.last[tid]?days(s.last[tid],date):0;s.ratings[3].forEach(r=>r[tid]*=Math.exp(-gap/90));}
}
function vector(s,e,x){const pace=x[24]>70&&x[24]<130?x[24]:100;return s.ratings.map((A,k)=>[... [0,2,3,4,5].map(j=>x[j]),...A.map(r=>(r[e.hid]-r[e.aid])*(k===4?pace/100:1))]);}
function featureRows(entries){
 const quality=Q.featureRows(entries,{observations:true}),rows=[],s=initial(),qr=quality.rows;
 for(let i=0;i<qr.length;){let end=i+1;while(end<qr.length&&qr[end].e.d===qr[i].e.d)end++;
  const d=qr[i].e.d,sy=qr[i].e.sy;prepare(s,sy,d,qr.slice(i,end).flatMap(r=>[r.e.hid,r.e.aid]));const delta=cube();
  for(let j=i;j<end;j++){
   const r=qr[j],e=r.e,h=e.hid,a=e.aid,pace=r.x[24]>70&&r.x[24]<130?r.x[24]:100,target=e.am+.5*r.noise[0];rows.push({e,x:vector(s,e,r.x),y:e.am});
   for(let k=0;k<6;k++)for(let t=0;t<3;t++){
    const diff=s.ratings[k][t][h]-s.ratings[k][t][a];let residual=(k===4?target*100/pace:target)-(2.3+diff);
    if(k===0)residual=clamp(residual,-15,15);else if(k===1)residual=20*Math.tanh(residual/20);else residual=clamp(residual,-35,35);
    if(k===5)residual=clamp(e.am+.5*r.noise[1]-(2.3+diff),-20,20);
    const v=RATES[t]*(k===2&&Math.min(s.games[h],s.games[a])<10?2:1)*residual;delta[k][t][h]+=v;delta[k][t][a]-=v;
   }
  }
  s.ratings.forEach((A,k)=>A.forEach((r,t)=>r.forEach((v,id)=>r[id]=v+delta[k][t][id])));
  for(let j=i;j<end;j++)for(const tid of [qr[j].e.hid,qr[j].e.aid]){s.games[tid]++;s.last[tid]=d;}i=end;
 }
 return {rows,state:s,qualityState:quality.state};
}
function score(entries){
 const r=entries.filter(e=>!e.po&&!e.nu&&!e.nm&&Number.isFinite(e.am)&&e.pg&&e.pg.robustShadow?.version===VERSION&&e.pg.at&&(e.pg.tip||e.tip)&&Date.parse(e.pg.at)<Date.parse(e.pg.tip||e.tip)&&Number.isFinite(e.pg.mm)&&Number.isFinite(e.pg.robustShadow.margin));
 return {n:r.length,official:M.metrics(r.map(e=>({y:e.am,base:e.pg.mm}))),shadow:M.metrics(r.map(e=>({y:e.am,base:e.pg.robustShadow.margin}))),automaticPromotion:false};
}
function build(entries,{cutoff,season}={}){
 if(!/^\d{4}-\d\d-\d\d$/.test(cutoff||''))return null;
 const data=M.clean(entries,cutoff);if(data.length<12000)return null;season=season||+cutoff.slice(0,4)+(+cutoff.slice(5,7)>=8?1:0);
 const f=featureRows(data),train=f.rows.filter(r=>r.e.sy>=season-4&&r.e.sy<season);if(train.length<2000)return null;
 const coeff=NAMES.map((_,k)=>M.ridge(train.map(r=>({x:r.x[k],y:r.y}))));if(coeff.some(c=>!c||!c.every(Number.isFinite)))return null;
 return {schema:1,version:VERSION,mode:'shadow',pointEnabled:false,season,trainedThrough:data[data.length-1].d,names:NAMES,coeff,state:f.state,qualityState:f.qualityState,trainN:train.length,config:{weights:NAMES.map(()=>1/6),trainSeasons:4,carry:.65,rates:RATES},prospective:score(entries)};
}
function forecast(model,g,f,date){
 if(!model||model.schema!==1||model.version!==VERSION||model.mode!=='shadow'||model.pointEnabled!==false||!model.state||!model.qualityState||!Array.isArray(model.coeff)||model.coeff.length!==6||!/^\d{4}-\d\d-\d\d$/.test(date||'')||!(date>model.trainedThrough&&days(model.trainedThrough,date)<=1)||model.season!==+date.slice(0,4)+(+date.slice(5,7)>=8?1:0)||![g.homeId,g.awayId].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||g.homeId===g.awayId||!f||!Number.isFinite(f.b)||!Array.isArray(f.x)||f.x.length!==7||!f.x.every(Number.isFinite))return null;
 try{
  const s=JSON.parse(JSON.stringify(model.state)),qs=JSON.parse(JSON.stringify(model.qualityState)),e={hid:g.homeId,aid:g.awayId,d:date,sy:model.season,f};
  prepare(s,model.season,date,[e.hid,e.aid]);if(qs.season!==model.season)Q.newSeason(qs,model.season,date);const X=vector(s,e,Q.vector(qs,e));
  if(X.some(x=>x.length!==8||!x.every(Number.isFinite))||model.coeff.some(c=>!Array.isArray(c)||c.length!==8||!c.every(Number.isFinite)))return null;
  const candidates=X.map((x,k)=>dot(x,model.coeff[k])),margin=candidates.reduce((a,b)=>a+b,0)/6;
  return Number.isFinite(margin)?{version:VERSION,margin,candidates,trainedThrough:model.trainedThrough}:null;
 }catch(e){return null;}
}
module.exports={VERSION,NAMES,featureRows,build,forecast,score};
