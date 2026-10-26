/* Causal shot-quality point-margin model. Pure JavaScript, shared by cloud and browser. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./margin-model'));else root.NBAQuality=factory(root.NBAMargin);})(typeof globalThis!=='undefined'?globalThis:this,function(M){
'use strict';
const VERSION='quality-v1',RATES=[.04,.08,.12],NAMES=['incumbent','raw','regress3','regressAll','fourFactors','combined'];
const COLS=[null,[0,2,3,4,5,11,12,13],[0,2,3,4,5,14,15,16],[0,2,3,4,5,17,18,19],[0,1,2,3,4,5,6,7,8,20,21,22,23,24],Array.from({length:27},(_,i)=>i)];
const zeros=n=>Array(n).fill(0),matrix=(a,b)=>Array.from({length:a},()=>zeros(b)),tensor=(a,b,c)=>Array.from({length:a},()=>matrix(b,c));
const dot=(x,c)=>x.reduce((s,v,k)=>s+v*c[k],0),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const days=(a,b)=>(Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/864e5;
const seasonOf=d=>+d.slice(0,4)+(+d.slice(5,7)>=8?1:0);
function initial(){return {season:null,through:null,ratings:tensor(3,3,31),shot:tensor(31,2,10),prevShot:tensor(31,2,10),league:zeros(10),prevLeague:[.5,1,.35,1,.75,1,0,0,0,0],factors:tensor(31,2,5),factorN:zeros(31),lastDates:Array.from({length:31},()=>[]),first:{}};}
function newSeason(s,season,date){
 s.ratings.forEach(a=>a.forEach(r=>r.forEach((v,k)=>r[k]=v*.65)));
 if(s.season!=null){if(s.league[1]>0)s.prevLeague=s.league.slice();s.prevShot=s.shot;}
 s.shot=tensor(31,2,10);s.league=zeros(10);s.lastDates=Array.from({length:31},()=>[]);
 s.factors.forEach(a=>a.forEach(r=>r.forEach((v,k)=>r[k]=v*.65)));s.factorN=s.factorN.map(v=>v*.65);s.season=season;s.first[season]=s.first[season]||date;
}
function shots(e,side){
 const t=e.tst&&e.tst[side],ts=e.ts&&e.ts[side];if(!t||!ts)return null;
 const pair=k=>{const a=String(t[k]).split('-').map(Number);return a.length===2&&a.every(Number.isFinite)?a:null;};
 const fg=pair('fieldGoalsMade-fieldGoalsAttempted'),p3=pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted'),ft=pair('freeThrowsMade-freeThrowsAttempted');if(!fg||!p3||!ft)return null;
 const v=[fg[0]-p3[0],fg[1]-p3[1],...p3,...ft,+(t.offensiveRebounds??ts[3]),+(t.defensiveRebounds??0),+(t.totalTurnovers??ts[4]),+ts[0]];
 if(!v.every(Number.isFinite)||v[1]<1||v[3]<0||Math.abs(2*v[0]+3*v[2]+v[4]-v[9])>1)return null;return v;
}
function vector(s,e){
 const h=e.hid,a=e.aid,diff=s.ratings.map(A=>A.map(r=>r[h]-r[a]));
 const fatigue=tid=>s.lastDates[tid].slice(-4).filter(d=>days(d,e.d)>0&&days(d,e.d)<=3).length>=2?1:0;
 const fs=[h,a].map(tid=>s.factors[tid].map(r=>r.map(v=>v/Math.max(.05,s.factorN[tid]))));
 const net=zeros(4).map((_,k)=>(fs[0][0][k]-fs[0][1][k])-(fs[1][0][k]-fs[1][1][k]));
 const age=days(s.first[e.sy]||e.d,e.d),base=[1,e.f.b,...e.f.x];base[5]=fatigue(h)-fatigue(a);
 return base.concat(age<14?e.f.b:0,age>=14&&age<30?e.f.b:0,...diff[0],...diff[1],...diff[2],...net,(fs[0][0][4]+fs[1][0][4])/2,Math.abs(diff[0][0]),age/180);
}
function featureRows(entries){
 const s=initial(),rows=[];let usable=0;
 for(let i=0;i<entries.length;){
  let end=i+1;while(end<entries.length&&entries[end].d===entries[i].d)end++;
  const date=entries[i].d,sy=entries[i].sy;if(sy!==s.season)newSeason(s,sy,date);
  const delta=tensor(3,3,31),staged=[];
  const lg=[s.prevLeague[0]/Math.max(1,s.prevLeague[1]),s.prevLeague[2]/Math.max(1,s.prevLeague[3]),s.prevLeague[4]/Math.max(1,s.prevLeague[5])];
  for(let j=i;j<end;j++){
   const e=entries[j],h=e.hid,a=e.aid;rows.push({e,x:vector(s,e),y:e.am});
   const H=shots(e,'h'),A=shots(e,'a');let adj3=0,adjAll=0;
   if(H&&A){
    usable++;
    const expected=(tid,opp)=>{
     const own=s.shot[tid][0].map((v,k)=>v+.2*s.prevShot[tid][0][k]),de=s.shot[opp][1].map((v,k)=>v+.2*s.prevShot[opp][1][k]);
     return [[0,1,400],[2,3,250],[4,5,100]].map(([mi,ai,prior],k)=>{const off=(own[mi]+prior*lg[k])/(own[ai]+prior),def=(de[mi]+prior*lg[k])/(de[ai]+prior);return clamp(k<2?off+(def-lg[k])*(k===1?.5:1):off,.1,.95);});
    };
    const hp=expected(h,a),ap=expected(a,h);adj3=3*(hp[1]*H[3]-H[2])+(hp[2]*H[5]-H[4])-3*(ap[1]*A[3]-A[2])-(ap[2]*A[5]-A[4]);adjAll=adj3+2*(hp[0]*H[1]-H[0])-2*(ap[0]*A[1]-A[0]);staged.push({h,a,H,A});
   }
   [e.am,e.am+.5*adj3,e.am+.5*adjAll].forEach((target,k)=>RATES.forEach((rate,r)=>{const diff=s.ratings[k][r][h]-s.ratings[k][r][a],v=rate*clamp(target-(2.3+diff),-35,35);delta[k][r][h]+=v;delta[k][r][a]-=v;}));
  }
  s.ratings.forEach((A,k)=>A.forEach((r,j)=>r.forEach((v,t)=>r[t]=v+delta[k][j][t])));
  for(const {h,a,H,A} of staged){
   for(let k=0;k<10;k++){s.shot[h][0][k]+=H[k];s.shot[h][1][k]+=A[k];s.shot[a][0][k]+=A[k];s.shot[a][1][k]+=H[k];s.league[k]+=H[k]+A[k];}
   const poss=(H[1]+H[3]-H[6]+H[8]+.44*H[5]+A[1]+A[3]-A[6]+A[8]+.44*A[5])/2;if(!(poss>60&&poss<150))continue;
   const fac=(v,opp)=>{const fga=v[1]+v[3];return [(v[0]+1.5*v[2])/Math.max(1,fga),v[8]/poss,v[6]/Math.max(1,v[6]+opp[7]),v[4]/Math.max(1,fga),poss];};
   const hf=fac(H,A),af=fac(A,H);
   for(const [tid,own,opp] of [[h,hf,af],[a,af,hf]]){[own,opp].forEach((r,k)=>r.forEach((v,j)=>s.factors[tid][k][j]=.95*s.factors[tid][k][j]+.05*v));s.factorN[tid]=.95*s.factorN[tid]+.05;}
  }
  for(let j=i;j<end;j++){const e=entries[j];for(const tid of [e.hid,e.aid]){s.lastDates[tid].push(date);if(s.lastDates[tid].length>4)s.lastDates[tid].shift();}}
  s.through=date;i=end;
 }
 return {rows,state:s,usable};
}
function fitPool(rows,season){
 const train=rows.filter(r=>r.e.sy>=season-4&&r.e.sy<season);if(train.length<2000)return null;
 const legacy=M.legacyModel(rows,season);if(!legacy)return null;
 const coeff=COLS.map((cols,k)=>k?M.ridge(train.map(r=>({x:cols.map(c=>r.x[c]),y:r.y}))):null);return {legacy,coeff,n:train.length};
}
const asMetric=(records,col)=>M.metrics(records.map(r=>({y:r.y,base:r.p[col]})));
function choose(records){
 if(records.length<2000)return {index:0,metrics:null};const ms=NAMES.map((_,k)=>asMetric(records,k)),b=ms[0];
 const eligible=ms.map((m,k)=>k).filter(k=>k&&ms[k].mae<=b.mae-.03&&ms[k].rmse<=b.rmse+.02&&ms[k].winner>=b.winner-.01);
 if(!eligible.length)return {index:0,metrics:ms};const best=Math.min(...eligible.map(k=>ms[k].mae));return {index:eligible.find(k=>ms[k].mae<=best+.02),metrics:ms};
}
const quantile=(v,q)=>{const x=v.slice().sort((a,b)=>a-b),t=(x.length-1)*q,i=Math.floor(t);return x[i]+(x[Math.min(i+1,x.length-1)]-x[i])*(t-i);};
function grid(history){const g=Array.from({length:161},(_,i)=>M.distribution(history,i*.25));for(let k=0;k<6;k++)g[0][k]=g[0][k+6]=(g[0][k]+g[0][k+6])/2;return g;}
function atGrid(g,margin){const x=Math.min(g.length-1,Math.abs(margin)/.25),lo=Math.floor(x),hi=Math.min(g.length-1,lo+1),f=x-lo;let p=g[lo].map((v,k)=>v*(1-f)+g[hi][k]*f);const sum=p.reduce((a,b)=>a+b,0);p=p.map(v=>v/sum);return margin>=0?p:p.slice(6).concat(p.slice(0,6));}
function bootstrap(records){
 const blocks={};records.forEach(r=>{const b=blocks[r.d]=blocks[r.d]||[0,0];b[0]+=Math.abs(r.y-r.selected)-Math.abs(r.y-r.p[0]);b[1]++;});const arr=Object.values(blocks);let seed=20261026;
 const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};const values=[];
 for(let n=0;n<3000;n++){let sum=0,count=0;for(let j=0;j<arr.length;j++){const b=arr[Math.floor(rand()*arr.length)];sum+=b[0];count+=b[1];}values.push(sum/count);}return [quantile(values,.025),quantile(values,.975)];
}
function prospective(entries){const e=entries.filter(e=>e.pg&&e.pg.qv&&Number.isFinite(e.pg.baseMargin)&&Number.isFinite(e.pg.mm)&&e.pg.at&&(e.pg.tip||e.tip)&&Date.parse(e.pg.at)<Date.parse(e.pg.tip||e.tip));return {n:e.length,baseline:M.metrics(e.map(e=>({y:e.am,base:e.pg.baseMargin}))),selected:M.metrics(e.map(e=>({y:e.am,base:e.pg.mm})))};}
function build(entries,{cutoff,season}={}){
 const data=M.clean(entries,cutoff);if(data.length<12000)return null;season=season||seasonOf(cutoff||data[data.length-1].d);const f=featureRows(data),rows=f.rows,folds=[];
 for(let sy=Math.max(data[0].sy+6,season-26);sy<season;sy++){
  const model=fitPool(rows,sy),test=rows.filter(r=>r.e.sy===sy);if(!model||test.length<300)continue;
  for(const r of test)folds.push({d:r.e.d,sy,y:r.y,p:[model.legacy(r,test[0].e.d),...COLS.slice(1).map((cols,j)=>dot(cols.map(c=>r.x[c]),model.coeff[j+1]))]});
 }
 const selections={},evaluated=[];
 for(let sy=Math.max(data[0].sy+13,season-19);sy<=season;sy++){
  const history=folds.filter(r=>r.sy>=sy-3&&r.sy<sy),decision=choose(history);selections[sy]={index:decision.index,name:NAMES[decision.index],selectionMetrics:decision.metrics};
  if(sy<season)for(const r of folds.filter(r=>r.sy===sy))evaluated.push({...r,choice:decision.index,selected:r.p[decision.index]});
 }
 const recent=evaluated.filter(r=>r.sy>=season-6),stats=list=>({baseline:M.metrics(list.map(r=>({y:r.y,base:r.p[0]}))),selected:M.metrics(list.map(r=>({y:r.y,base:r.selected})))});
 const annual=[];for(const sy of [...new Set(evaluated.map(r=>r.sy))]){const records=evaluated.filter(r=>r.sy===sy);annual.push({season:sy,name:selections[sy].name,...stats(records)});}
 const ci=bootstrap(recent),current=selections[season],recentStats=stats(recent),improved=annual.filter(r=>r.season>=season-6&&r.selected.mae<r.baseline.mae-1e-8).length;
 const enabled=current.index>0&&recent.length>=6000&&recentStats.selected.mae<recentStats.baseline.mae-.05&&recentStats.selected.rmse<=recentStats.baseline.rmse&&recentStats.selected.winner>=recentStats.baseline.winner&&improved>=5&&ci[1]<0;
 const history=evaluated.filter(r=>r.sy>=season-3&&r.sy<season).map(r=>({base:r.selected,y:r.y}));if(history.length<2000)return null;
 const validation=[];
 for(let sy=season-6;sy<season;sy++){
  const tr=evaluated.filter(r=>r.sy>=sy-3&&r.sy<sy),te=evaluated.filter(r=>r.sy===sy);if(tr.length<2000||te.length<300)continue;
  const bt=tr.map(r=>({base:r.p[0],y:r.y})),qt=tr.map(r=>({base:r.selected,y:r.y})),bg=grid(bt),qg=grid(qt),rr=qt.map(r=>r.y-r.base),lo=quantile(rr,.1),hi=quantile(rr,.9);
  validation.push({season:sy,name:selections[sy].name,baseline:M.metrics(te.map(r=>({base:r.p[0],y:r.y})),te.map(r=>atGrid(bg,r.p[0]))),selected:M.metrics(te.map(r=>({base:r.selected,y:r.y})),te.map(r=>atGrid(qg,r.selected))),referenceCoverage:te.filter(r=>r.y>=r.selected+lo&&r.y<=r.selected+hi).length/te.length});
 }
 const final=fitPool(rows,season),residual=history.map(r=>r.y-r.base);
 return {schema:1,version:VERSION,enabled,pointEnabled:enabled,season,trainedThrough:f.state.through,selection:{name:current.name,index:current.index,coeff:final.coeff[current.index],columns:COLS[current.index],trainN:final.n,metrics:current.selectionMetrics},state:f.state,
  config:{trainSeasons:4,selectionSeasons:3,supported:NAMES,shotRegression:.5,carry:.65,rates:RATES},statistics:{all:stats(evaluated),recent:recentStats,annual,maeDifferenceCI95:ci,improvedRecentSeasons:improved},validation,
  gate:{passed:enabled,criterion:'six-season nested MAE improvement > .05, RMSE/winner non-regression, at least five improved seasons, paired-day CI upper < 0'},
  grid:{step:.25,probabilities:grid(history)},residual:{n:residual.length,q10:quantile(residual,.1),q25:quantile(residual,.25),q75:quantile(residual,.75),q90:quantile(residual,.9),validationCoverage:validation.length?validation.reduce((s,r)=>s+r.referenceCoverage*r.selected.n,0)/validation.reduce((s,r)=>s+r.selected.n,0):null},prospective:prospective(entries),data:{games:data.length,withShots:f.usable}};
}
function valid(model,date){return !!(M.valid(model,date)&&model.pointEnabled&&days(model.trainedThrough,date)<=1);}
function forecast(model,g,f,date){
 if(!valid(model,date)||!model.selection||!model.state||!f||!Number.isFinite(f.b)||!Array.isArray(f.x)||f.x.length!==7)return null;
 try{
 const s=JSON.parse(JSON.stringify(model.state)),sy=seasonOf(date);if(s.season!==sy)newSeason(s,sy,date);
 const x=vector(s,{hid:g.homeId,aid:g.awayId,d:date,sy,f}),sel=model.selection;if(!Array.isArray(sel.columns)||!Array.isArray(sel.coeff)||sel.coeff.length!==sel.columns.length)return null;
 const values=sel.columns.map(k=>x[k]);if(!values.every(Number.isFinite)||!sel.coeff.every(Number.isFinite))return null;
 return {margin:dot(values,sel.coeff),name:sel.name,version:model.version};
 }catch(e){return null;}
}
return {VERSION,NAMES,COLS,initial,newSeason,shots,vector,featureRows,fitPool,choose,grid,atGrid,build,valid,forecast};
});
