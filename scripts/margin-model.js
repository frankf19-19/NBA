/* NBA margin research: shared, deterministic, no network and no external dependencies. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NBAMargin=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='margin-v1',RATES=[.04,.08,.12],CARRY=.65,CLIP=35;
const finite=Number.isFinite,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const seasonOf=d=>+d.slice(0,4)+(+d.slice(5,7)>=8?1:0);
const phaseDays=d=>d<14?0:d<30?1:d<60?2:d<120?3:4;
const dayDiff=(a,b)=>(Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/864e5;
function clean(entries,cutoff){
 const seen=new Set();return entries.filter(e=>{
  if(!e||e.po||e.nu||e.nm||!finite(e.am)||!e.am||!e.f||!Array.isArray(e.f.x)||e.f.x.length!==7||!finite(e.f.b)||!e.f.x.every(finite)||!(e.hid>=1&&e.hid<=30&&e.aid>=1&&e.aid<=30)||!/^\d{4}-\d\d-\d\d$/.test(e.d||'')||(cutoff&&e.d>=cutoff))return false;
  const key=e.d+'|'+e.hid+'|'+e.aid;if(seen.has(key))return false;seen.add(key);return true;
 }).map(e=>({...e,sy:e.sy||seasonOf(e.d)})).sort((a,b)=>a.d.localeCompare(b.d)||String(a.id).localeCompare(String(b.id)));
}
function featureRows(entries){
 const ratings=RATES.map(()=>Array(31).fill(0)),rows=[];let sy=null;
 for(let i=0;i<entries.length;){
  let end=i+1;while(end<entries.length&&entries[end].d===entries[i].d)end++;
  if(sy!==entries[i].sy){ratings.forEach(r=>r.forEach((v,k)=>r[k]=v*CARRY));sy=entries[i].sy;}
  const delta=RATES.map(()=>Array(31).fill(0));
  for(let j=i;j<end;j++){
   const e=entries[j],diff=ratings.map(r=>r[e.hid]-r[e.aid]);
   rows.push({e,x:[1,...e.f.x.slice(0,4),...diff],y:e.am});
   RATES.forEach((rate,k)=>{const adj=rate*clamp(e.am-(2.3+diff[k]),-CLIP,CLIP);delta[k][e.hid]+=adj;delta[k][e.aid]-=adj;});
  }
  ratings.forEach((r,k)=>r.forEach((v,t)=>r[t]=v+delta[k][t]));i=end;
 }
 return {rows,state:{season:sy,through:entries.length?entries[entries.length-1].d:null,ratings}};
}
function solve(A,b){
 const n=b.length,M=A.map((r,i)=>r.slice().concat(b[i]));
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
  if(Math.abs(M[p][c])<1e-10)return null;[M[p],M[c]]=[M[c],M[p]];
  const a=M[c][c];for(let k=c;k<=n;k++)M[c][k]/=a;
  for(let r=0;r<n;r++)if(r!==c){const f=M[r][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}
 }
 return M.map(r=>r[n]);
}
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function ridge(rows){
 const n=rows.length,k=rows[0].x.length,mean=Array(k).fill(0),scale=Array(k).fill(0);
 rows.forEach(r=>r.x.forEach((v,j)=>mean[j]+=v/n));rows.forEach(r=>r.x.forEach((v,j)=>scale[j]+=(v-mean[j])**2/n));
 scale.forEach((v,j)=>scale[j]=Math.sqrt(v)||1);
 const A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);
 for(const r of rows){const x=r.x.map((v,j)=>v/scale[j]);for(let j=0;j<k;j++){b[j]+=x[j]*r.y;for(let l=0;l<k;l++)A[j][l]+=x[j]*x[l];}}
 A.forEach((r,j)=>r[j]+=j?10:1e-8);const c=solve(A,b);return c?c.map((v,j)=>v/scale[j]):null;
}
// Reproduce the incumbent annual fit using ONLY seasons earlier than the target.
function legacyModel(rows,season){
 const past=rows.filter(r=>r.e.sy<season),train=past.filter(r=>r.e.sy>=season-4);
 if(train.length<2000)return null;
 const xOf=r=>[r.e.f.b,1,...r.e.f.x];let cols=Array.from({length:9},(_,i)=>i),coeff=null;
 for(let it=0;it<9;it++){
  cols=cols.filter(ci=>ci<2||train.some(r=>xOf(r)[ci]!==0));const k=cols.length;
  const A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);
  train.forEach(r=>{const x=xOf(r);for(let a=0;a<k;a++){b[a]+=x[cols[a]]*r.y;for(let j=0;j<k;j++)A[a][j]+=x[cols[a]]*x[cols[j]];}});
  coeff=solve(A,b);if(!coeff||coeff[0]<=.3)return null;
  const rss=train.reduce((s,r)=>s+(r.y-dot(cols.map(c=>xOf(r)[c]),coeff))**2,0),s2=rss/Math.max(1,train.length-k);
  let drop=null,tMin=2;
  for(let j=0;j<k;j++){if(cols[j]<2)continue;const unit=Array(k).fill(0);unit[j]=1;const inv=solve(A,unit);const se=inv?Math.sqrt(Math.max(0,s2*inv[j])):Infinity;const t=Math.abs(coeff[j]/se);if(t<tMin){drop=cols[j];tMin=t;}}
  if(drop==null)break;cols=cols.filter(c=>c!==drop);
 }
 const prm=Array(9).fill(0);prm[0]=1;
 cols.forEach((ci,j)=>{if(ci===1)prm[ci]=+clamp(coeff[j]/coeff[0],-1,6).toFixed(2);if(ci>=2)prm[ci]=+clamp(coeff[j]/coeff[0],-5,5).toFixed(2);});
 const raw=r=>dot(xOf(r),prm),first={};past.forEach(r=>first[r.e.sy]=first[r.e.sy]||r.e.d);
 const ph=r=>phaseDays(dayDiff(first[r.e.sy]||r.e.d,r.e.d));
 const learnPh=list=>{
  const den=list.reduce((s,r)=>s+raw(r)**2,0),K=den?list.reduce((s,r)=>s+raw(r)*r.y,0)/den:1;
  return {K,m:[0,1,2,3,4].map(k=>{const g=list.filter(r=>ph(r)===k);if(g.length<200)return 1;const dd=g.reduce((s,r)=>s+raw(r)**2,0);return dd?+clamp(g.reduce((s,r)=>s+raw(r)*r.y,0)/dd/K,.6,1.4).toFixed(3):1;})};
 };
 let mult=Array(5).fill(1);const tr=past.filter(r=>r.e.sy>=season-9&&r.e.sy<=season-5),te=past.filter(r=>r.e.sy>=season-4);
 if(tr.length>3000&&te.length>2000){const f=learnPh(tr);const before=te.reduce((s,r)=>s+Math.abs(r.y-f.K*raw(r)),0)/te.length,after=te.reduce((s,r)=>s+Math.abs(r.y-f.K*raw(r)*f.m[ph(r)]),0)/te.length;
  if(after<before-.005)mult=learnPh(past.filter(r=>r.e.sy>=season-8)).m;}
 const rp=r=>raw(r)*mult[ph(r)],win=past.slice(-2500),den=win.reduce((s,r)=>s+rp(r)**2,0),K=den?clamp(win.reduce((s,r)=>s+rp(r)*r.y,0)/den,.5,1.5):1;
 // First day of target is used only to assign a calendar phase, never to fit parameters.
 return (r,targetFirst)=>{const p=phaseDays(dayDiff(first[r.e.sy]||targetFirst||r.e.d,r.e.d));return K*raw(r)*mult[p];};
}
function oof(rows,season){
 const tr=rows.filter(r=>r.e.sy>=season-4&&r.e.sy<season),te=rows.filter(r=>r.e.sy===season);
 if(tr.length<2000||!te.length)return [];
 const c=ridge(tr),legacy=legacyModel(rows,season);if(!c||!legacy)return [];
 return te.map(r=>({d:r.e.d,sy:season,y:r.y,base:legacy(r,te[0].e.d),challenger:dot(r.x,c)}));
}
function cdf(z){const s=z<0?-1:1,x=Math.abs(z)/Math.SQRT2,t=1/(1+.3275911*x);return .5*(1+s*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x)));}
const EDGES=[[.5,5.5],[5.5,10.5],[10.5,15.5],[15.5,20.5],[20.5,25.5],[25.5,1e6]];
function normalize(p){const sum=p.reduce((s,v)=>s+v,0);if(!(sum>0)||p.some(v=>!finite(v)||v<0))return null;return p.map(v=>v/sum);}
function normal(mu,sigma){const p=[];for(const sign of [1,-1])for(const [lo,hi] of EDGES){const a=sign>0?lo:-hi,b=sign>0?hi:-lo;p.push(Math.max(0,cdf((b-mu)/sigma)-cdf((a-mu)/sigma)));}return normalize(p);}
function actual(y){return Math.min(5,Math.floor((Math.abs(y)-1)/5))+(y>0?0:6);}
function distribution(history,mu,method='kernel'){
 const sigma=Math.sqrt(history.reduce((s,r)=>s+(r.y-r.base)**2,0)/history.length),prior=100,base=normal(mu,sigma),counts=Array(12).fill(0);let n=0;
 let width=1.5;if(method==='window')while(history.filter(r=>Math.abs(Math.abs(r.base)-mu)<=width).length<300&&width<8)width++;
 for(const r of history){const dx=Math.abs(r.base)-mu,w=method==='window'?(Math.abs(dx)<=width?1:0):Math.exp(-.5*(dx/2)**2);counts[actual(r.y*(r.base>=0?1:-1))]+=w;n+=w;}
 if(method==='window')return n?normalize(counts):base;
 return normalize(counts.map((v,i)=>(v+prior*base[i])/(n+prior)));
}
const home=(p,margin)=>margin>=0?p:p.slice(6).concat(p.slice(0,6));
function quantile(v,q){const x=v.slice().sort((a,b)=>a-b),i=(x.length-1)*q,j=Math.floor(i);return x[j]+(x[Math.min(j+1,x.length-1)]-x[j])*(i-j);}
function metrics(rows,probs){
 let ae=0,sq=0,hit=0,full=0,ll=0,brier=0;
 rows.forEach((r,j)=>{ae+=Math.abs(r.y-r.base);sq+=(r.y-r.base)**2;hit+=(r.y>0)===(r.base>=0);if(probs){const p=probs[j],c=actual(r.y);full+=p.indexOf(Math.max(...p))===c;ll-=Math.log(Math.max(1e-8,p[c]));brier+=p.reduce((s,v,k)=>s+(v-(k===c?1:0))**2,0);}});
 const n=rows.length;return n?{n,mae:ae/n,rmse:Math.sqrt(sq/n),winner:hit/n,...(probs?{full:full/n,logloss:ll/n,brier:brier/n}:{})}:null;
}
function prospective(entries){
 const rows=entries.filter(e=>e.pg&&finite(e.pg.shadow)&&finite(e.pg.mm)&&finite(e.am)&&e.pg.at&&(e.pg.tip||e.tip)&&Date.parse(e.pg.at)<Date.parse(e.pg.tip||e.tip));
 return {n:rows.length,incumbent:metrics(rows.map(e=>({y:e.am,base:e.pg.mm}))),challenger:metrics(rows.map(e=>({y:e.am,base:e.pg.shadow})))};
}
function build(entries,{cutoff,season}={}){
 const data=clean(entries,cutoff),f=featureRows(data);if(data.length<5000)return null;
 season=season||seasonOf(cutoff||data[data.length-1].d);
 const folds=[];const firstSy=data[0].sy;
 for(let sy=Math.max(firstSy+3,season-7);sy<=season;sy++)folds.push(...oof(f.rows,sy));
 const history=folds.filter(r=>r.sy>=season-3&&r.sy<season);if(history.length<2000)return null;
 const step=.25,grid=[];
 for(let i=0;i<=40/step;i++)grid.push(distribution(history,i*step));
 // At zero expected margin both orientations must be identical.
 for(let k=0;k<6;k++)grid[0][k]=grid[0][k+6]=(grid[0][k]+grid[0][k+6])/2;
 const train=f.rows.filter(r=>r.e.sy>=season-4&&r.e.sy<season),coeff=ridge(train),residual=history.map(r=>r.y-r.base);
 const validation=[];
 for(let sy=season-2;sy<season;sy++){
  const tr=folds.filter(r=>r.sy>=sy-3&&r.sy<sy),te=folds.filter(r=>r.sy===sy);if(tr.length<2000||te.length<300)continue;
  const residuals=tr.map(r=>r.y-r.base),lo=quantile(residuals,.1),hi=quantile(residuals,.9);
  const foldGrid=Array.from({length:161},(_,i)=>distribution(tr,i*.25));
  for(let k=0;k<6;k++)foldGrid[0][k]=foldGrid[0][k+6]=(foldGrid[0][k]+foldGrid[0][k+6])/2;
  validation.push({season:sy,referenceCoverage:te.filter(r=>r.y>=r.base+lo&&r.y<=r.base+hi).length/te.length,baseline:metrics(te,te.map(r=>home(distribution(tr,Math.min(30,Math.round(Math.abs(r.base)/.5)*.5),'window'),r.base))),kernel:metrics(te,te.map(r=>gridProbability(foldGrid,.25,r.base)))});
 }
 const through=data[data.length-1].d;
 const enabled=validation.length>=2&&validation.every(v=>v.kernel.logloss<v.baseline.logloss)&&validation.reduce((s,v)=>s+(v.kernel.full-v.baseline.full)*v.kernel.n,0)>=0;
 return {schema:1,version:VERSION,trainedThrough:through,season,enabled,gate:{criterion:'two completed seasons: lower log loss in both; no aggregate top-1 loss',passed:enabled},pointEnabled:false,source:'rolling-out-of-sample',config:{rates:RATES,carry:CARRY,residualClip:CLIP,bandwidth:2,prior:100,trainSeasons:4,historySeasons:3},
  grid:{step,probabilities:grid},residual:{validationCoverage:validation.length?validation.reduce((s,v)=>s+v.referenceCoverage*v.kernel.n,0)/validation.reduce((s,v)=>s+v.kernel.n,0):null,n:residual.length,q10:quantile(residual,.1),q25:quantile(residual,.25),q75:quantile(residual,.75),q90:quantile(residual,.9)},
  challenger:{coeff,state:f.state,enabled:false,trainN:train.length},validation,prospective:prospective(entries)};
}
function valid(model,date){return !!(model&&model.schema===1&&model.enabled&&model.grid&&model.trainedThrough&&date>model.trainedThrough&&dayDiff(model.trainedThrough,date)<=4&&seasonOf(date)===model.season);}
function gridProbability(g,step,margin){
 if(!finite(margin)||!Array.isArray(g)||g.length<2||!(step>0))return null;
 const x=Math.min(g.length-1,Math.abs(margin)/step),lo=Math.floor(x),hi=Math.min(g.length-1,lo+1),a=x-lo;
 if(!Array.isArray(g[lo])||g[lo].length!==12||!Array.isArray(g[hi])||g[hi].length!==12)return null;
 const p=normalize(g[lo].map((v,i)=>v*(1-a)+g[hi][i]*a));return p?home(p,margin):null;
}
function probabilities(model,margin,date){
 if(!valid(model,date))return null;return gridProbability(model.grid.probabilities,model.grid.step,margin);
}
function forecast(model,g,f,date){
 if(!valid(model,date)||!model.challenger||!f||!Array.isArray(f.x))return null;
 const {coeff,state}=model.challenger;if(!Array.isArray(coeff)||coeff.length!==8||!coeff.every(finite)||!state||!Array.isArray(state.ratings)||state.ratings.length!==3||!state.ratings.every(r=>Array.isArray(r)&&r.length===31))return null;
 const carry=state.season===seasonOf(date)?1:CARRY;
 const diff=state.ratings.map(r=>(r[g.homeId]-r[g.awayId])*carry),x=[1,...f.x.slice(0,4),...diff];if(!x.every(finite))return null;
 return dot(x,coeff);
}
function interval(model,margin,date){if(!valid(model,date)||!model.residual)return null;const r=model.residual;if(!finite(r.q10)||!finite(r.q90)||r.q10>r.q90)return null;return {lo:margin+r.q10,hi:margin+r.q90,coverage:.8,observedCoverage:r.validationCoverage,n:r.n};}
return {VERSION,clean,featureRows,ridge,legacyModel,oof,cdf,normal,actual,distribution,metrics,build,valid,probabilities,forecast,interval};
});
