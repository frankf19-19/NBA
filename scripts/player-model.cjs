'use strict';
/* 球員層實力模型(player-v1):以「誰上場」計算球隊實力,補足球隊整體評分看不到的陣容變化(傷兵、交易、輪換)。
   每位球員:正負值率(pm / (上場分鐘 + K),時間衰減)與攻擊產出率((得分+0.5籃板+0.8助攻)/分鐘)。
   球隊實力 = 預計上場球員依預期上場時間加權(總和 240 分鐘)後的合計;換季時球員數據打 carry 折延續(球員換隊會跟著走)。
   最終分差 = a + c×正負值差 + cx×產出差 + cb×原模型原始分差(mp),係數以過去 5 個完整球季的逐場時序資料擬合。
   嚴格時序:每場只用之前的比賽;是否啟用由逐季時間外驗證決定(門檻事先寫死,見 GATE)。 */
const VERSION='player-v1.1';
const CFG={decay:0.985,k:150,minDecay:0.8,carry:0.8,firstSeason:2010,trainSeasons:5,validateSeasons:6,absMiss:3,absMin:18,absGames:5};
/* 缺陣衝擊(player-v1.1):主力剛缺陣的前幾場(已缺 ≤absMiss 場、平常上場 ≥absMin 分鐘),隊友的正負值還帶著「跟他一起打」的成績,
   球隊評分也還沒反應,模型會低估損失(2016–27 共 1.4 萬隊次驗證:28+ ppg 球星缺陣,模型扣 3.6 分、實際再差 1.8 分)。
   加兩個特徵:實際陣容實力 −「他若有打」的陣容實力(正負值、產出各一),係數由資料學;逐季驗證通過(ABS_GATE)才啟用。 */
const ABS_GATE={minImprove:0.01,minSeasonsImproved:5};
const GATE={minImprove:0.05,minSeasonsImproved:5,winnerTolerance:0.005};
const rate=p=>p?p.pm/(p.min+CFG.k):0;
const boxr=p=>p&&p.bmin>50?p.bp/p.bmin:0;

function replay(LED){
  const G=LED.filter(e=>e&&e.st===2&&!e.po&&e.sy>=CFG.firstSeason&&e.pl&&e.pl.h&&e.pl.a&&Number.isFinite(e.am))
    .sort((a,b)=>a.d.localeCompare(b.d)||String(a.id).localeCompare(String(b.id)));
  const P={},T={},N={},rows=[];let cur=0;
  const strength=(tid,list,avail)=>{
    const cands=avail?list.filter(x=>x.min>0).map(x=>x.id):[...(T[tid]||new Set())];
    let tot=0;const ws=[];
    for(const id of cands){const p=P[id];const em=p&&p.em!=null?p.em:(avail?12:0);if(em>0){ws.push([p,em]);tot+=em;}}
    if(!tot)return null;const sc=240/tot;let s=0,b=0;
    for(const [p,em] of ws){s+=em*sc*rate(p);b+=em*sc*boxr(p);}
    return [s/5,b/5];
  };
  for(const e of G){
    if(e.sy!==cur){for(const id in P){const p=P[id];p.pm*=CFG.carry;p.min*=CFG.carry;p.bp*=CFG.carry;p.bmin*=CFG.carry;p.gp*=CFG.carry;p.lastN=-99;}for(const t in T)T[t]=new Set();for(const t in N)N[t]=0;cur=e.sy;}
    const h1=strength(e.hid,e.pl.h,true),a1=strength(e.aid,e.pl.a,true),h0=strength(e.hid,e.pl.h,false),a0=strength(e.aid,e.pl.a,false);
    const base=Number.isFinite(e.mp)?e.mp:e.m;
    /* 缺陣衝擊特徵:剛缺陣的主力若有打(用他平常的上場時間 emp)時的陣容實力,與實際陣容的差 */
    const shock=(tid,list,curS)=>{const played=new Set(list.filter(x=>x.min>0).map(x=>+x.id)),back=[];
      for(const id of (T[tid]||[])){const p=P[id];if(!p||played.has(id)||p.tid!==tid)continue;if(p.emp>=CFG.absMin&&(N[tid]||0)-p.lastN<=CFG.absMiss&&p.gp>=CFG.absGames)back.push(p);}
      if(!back.length||!curS)return [0,0];
      let tot=0;const ws=[];for(const x of list){if(!(x.min>0))continue;const p=P[x.id];const em=p&&p.em!=null?p.em:12;if(em>0){ws.push([p,em]);tot+=em;}}
      for(const p of back){ws.push([p,p.emp]);tot+=p.emp;}
      const sc=240/tot;let s=0,b=0;for(const [p,em] of ws){s+=em*sc*rate(p);b+=em*sc*boxr(p);}
      return [curS[0]-s/5,curS[1]-b/5];};
    const sh=h1?shock(e.hid,e.pl.h,h1):[0,0],sa=a1?shock(e.aid,e.pl.a,a1):[0,0];
    if(h1&&a1&&Number.isFinite(base))rows.push({id:e.id,d:e.d,sy:e.sy,am:e.am,base,x:h1[0]-a1[0],xb:h1[1]-a1[1],xa:sh[0]-sa[0],xab:sh[1]-sa[1],x0:h0&&a0?h0[0]-a0[0]:null,xb0:h0&&a0?h0[1]-a0[1]:null});
    for(const [side,tid] of [['h',e.hid],['a',e.aid]]){
      T[tid]=T[tid]||new Set();N[tid]=(N[tid]||0)+1;const played=new Set();
      for(const pl of e.pl[side]){if(!pl.min)continue;played.add(+pl.id);
        const p=P[pl.id]=P[pl.id]||{pm:0,min:0,bp:0,bmin:0,em:null,emp:null,gp:0,lastN:-99,tid:null,last:null};
        p.pm=p.pm*CFG.decay+(pl.pm||0);p.min=p.min*CFG.decay+pl.min;
        p.bp=p.bp*CFG.decay+(pl.pts||0)+.5*(pl.reb||0)+.8*(pl.ast||0);p.bmin=p.bmin*CFG.decay+pl.min;
        p.em=p.em==null?pl.min:p.em*CFG.minDecay+pl.min*(1-CFG.minDecay);p.emp=p.emp==null?pl.min:p.emp*CFG.minDecay+pl.min*(1-CFG.minDecay);p.gp=p.gp*CFG.decay+1;p.lastN=N[tid];p.tid=tid;p.last=e.d;T[tid].add(+pl.id);}
      for(const id of T[tid]){const p=P[id];if(!played.has(id)&&p){p.em*=CFG.minDecay;if(p.tid!==tid)T[tid].delete(id);}}
    }
  }
  return {P,N,rows,season:cur};
}
function ols(rows,f){
  const X=rows.map(f),y=rows.map(r=>r.am),k=X[0].length,A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);
  X.forEach((xi,n)=>{for(let i=0;i<k;i++){b[i]+=xi[i]*y[n];for(let j=0;j<k;j++)A[i][j]+=xi[i]*xi[j];}});
  for(let i=0;i<k;i++)A[i][i]+=1e-6;
  const M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<k;i++){let p=i;for(let r=i+1;r<k;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;[M[i],M[p]]=[M[p],M[i]];
    for(let r=0;r<k;r++)if(r!==i){const q=M[r][i]/M[i][i];for(let c=i;c<=k;c++)M[r][c]-=q*M[i][c];}}
  return M.map((r,i)=>r[k]/r[i]);
}
const feat=r=>[1,r.x,r.xb,r.base],feat0=r=>[1,r.x0,r.xb0,r.base],featA=r=>[1,r.x,r.xb,r.base,r.xa,r.xab];
const pred=(w,r,f=feat)=>f(r).reduce((s,v,i)=>s+v*w[i],0);
function build(LED,{season}){
  const {P,N,rows}=replay(LED);
  const validation=[];
  for(let s=season-CFG.validateSeasons;s<season;s++){
    const tr=rows.filter(r=>r.sy<s&&r.sy>=s-CFG.trainSeasons),te=rows.filter(r=>r.sy===s&&r.x0!=null);
    if(tr.length<2000||te.length<500)continue;
    const w=ols(tr,feat0),wb=ols(tr,r=>[1,r.base]);
    const m=f=>te.reduce((a,r)=>a+Math.abs(r.am-f(r)),0)/te.length,h=f=>te.filter(r=>(f(r)>0)===(r.am>0)).length/te.length;
    validation.push({season:s,n:te.length,baseMae:+m(r=>pred(wb,r,x=>[1,x.base])).toFixed(3),playerMae:+m(r=>pred(w,r,feat0)).toFixed(3),
      baseWin:+h(r=>pred(wb,r,x=>[1,x.base])).toFixed(4),playerWin:+h(r=>pred(w,r,feat0)).toFixed(4)});
  }
  const NV=validation.reduce((a,v)=>a+v.n,0)||1,avg=k=>validation.reduce((a,v)=>a+v[k]*v.n,0)/NV;
  const improve=avg('baseMae')-avg('playerMae'),improved=validation.filter(v=>v.playerMae<v.baseMae).length,winDiff=avg('playerWin')-avg('baseWin');
  const passed=validation.length>=CFG.validateSeasons&&improve>=GATE.minImprove&&improved>=GATE.minSeasonsImproved&&winDiff>=-GATE.winnerTolerance;
  /* 缺陣衝擊的逐季驗證(都用實際上場名單,比較有無這兩個特徵) */
  const absVal=[];
  for(let s=season-CFG.validateSeasons;s<season;s++){
    const tr=rows.filter(r=>r.sy<s&&r.sy>=s-CFG.trainSeasons),te=rows.filter(r=>r.sy===s);if(tr.length<2000||te.length<500)continue;
    const w0=ols(tr,feat),w1=ols(tr,featA),m=(w,f)=>te.reduce((a,r)=>a+Math.abs(r.am-pred(w,r,f)),0)/te.length;
    absVal.push({season:s,n:te.length,without:+m(w0,feat).toFixed(3),with:+m(w1,featA).toFixed(3)});
  }
  const aN=absVal.reduce((a,v)=>a+v.n,0)||1,absImprove=absVal.reduce((a,v)=>a+(v.without-v.with)*v.n,0)/aN,absSeasons=absVal.filter(v=>v.with<v.without).length;
  const absPassed=absVal.length>=CFG.validateSeasons&&absImprove>=ABS_GATE.minImprove&&absSeasons>=ABS_GATE.minSeasonsImproved;
  const tr=rows.filter(r=>r.sy<season&&r.sy>=season-CFG.trainSeasons),coef=tr.length>2000?ols(tr,absPassed?featA:feat):null;
  const players={};
  for(const id in P){const p=P[id];if(!p.last||p.em==null||p.em<0.5)continue;if(+p.last.slice(0,4)<season-2)continue;
    players[id]={t:p.tid,r:+rate(p).toFixed(5),b:+boxr(p).toFixed(4),em:+p.em.toFixed(1),l:p.last};
    if(p.emp>=CFG.absMin&&p.gp>=CFG.absGames&&p.lastN>0){const ms=(N[p.tid]||0)-p.lastN;if(ms>=0&&ms<=CFG.absMiss){players[id].ep=+p.emp.toFixed(1);players[id].ms=ms;}}}
  const last=rows.length?rows[rows.length-1].d:null;
  return {schema:1,version:VERSION,season,enabled:!!(passed&&coef),config:CFG,gate:{...GATE,passed,improve:+improve.toFixed(3),improvedSeasons:improved,seasons:validation.length,winnerDiff:+winDiff.toFixed(4)},
    absence:{...ABS_GATE,passed:absPassed,improve:+absImprove.toFixed(3),improvedSeasons:absSeasons,validation:absVal},
    validation,coef:coef&&coef.map(v=>+v.toFixed(4)),trainedThrough:last,players};
}
/* 單場分差(網頁與雲端共用的算法說明;網頁版在 index.html playerMargin)。
   avail:球員 id → 上場機率(0~1,依官方/ESPN 傷兵狀態);roster:該隊球員 id 清單。 */
function teamStrength(model,roster,avail){
  let tot=0;const ws=[];
  for(const id of roster){const p=model.players[id];if(!p)continue;const pr=avail&&avail[id]!=null?avail[id]:1;const em=p.em*pr;if(em>0){ws.push([p,em]);tot+=em;}}
  if(!tot)return null;const sc=240/tot;let s=0,b=0;for(const [p,em] of ws){s+=em*sc*p.r;b+=em*sc*p.b;}return [s/5,b/5];
}
module.exports={VERSION,CFG,GATE,replay,build,teamStrength,ols};
