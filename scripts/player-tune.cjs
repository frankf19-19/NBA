'use strict';
/* 球員層自動調參(player-tune-v1):每週一次,把每個可調設定往上、往下各試一步,
   用過去 6 個完整球季逐季時間外驗證(每季只用更早 5 季擬合係數),找出能讓勝分差誤差變小的設定。
   事先寫死的採用門檻:平均每場誤差至少再少 0.003 分,且 6 季中至少 5 季進步(靠多季一致性防止碰運氣);沒過就維持原設定。
   每週最多改一個設定、一步,所以是緩慢而穩定地往更好的方向走;每次結果(含沒採用的)都記在 player-tune.json。 */
const PM=require('./player-model.cjs');
const VERSION='player-tune-v1';
const GATE={minImprove:0.003,minSeasonsImproved:5};
const STEP={decay:{d:0.005,min:0.95,max:0.997},k:{d:50,min:50,max:600},minDecay:{d:0.05,min:0.6,max:0.95},carry:{d:0.1,min:0.4,max:1},absMiss:{d:1,min:1,max:8},absMin:{d:3,min:12,max:28}};
function score(LED,season,cfg){
  return PM.withCfg(cfg,()=>{
    const {rows}=PM.replay(LED),out=[];
    for(let s=season-PM.CFG.validateSeasons;s<season;s++){
      const tr=rows.filter(r=>r.sy<s&&r.sy>=s-PM.CFG.trainSeasons),te=rows.filter(r=>r.sy===s);if(tr.length<2000||te.length<500)continue;
      const w=PM.ols(tr,PM.featA);out.push({s,n:te.length,mae:te.reduce((a,r)=>a+Math.abs(r.am-PM.featA(r).reduce((x,v,i)=>x+v*w[i],0)),0)/te.length});
    }
    const N=out.reduce((a,v)=>a+v.n,0)||1;return {mae:out.reduce((a,v)=>a+v.mae*v.n,0)/N,seasons:out};
  });
}
const r3=v=>+(+v).toFixed(4);
function tune(LED,season,prev,today){
  const cur={...PM.BASE_CFG,...((prev&&prev.cfg)||{})};
  const base=score(LED,season,cur),tried=[];let best=null;
  for(const k of PM.TUNABLE){const st=STEP[k];if(!st)continue;
    for(const dir of [-1,1]){const v=r3(Math.min(st.max,Math.max(st.min,cur[k]+dir*st.d)));if(v===cur[k])continue;
      const cand={...cur,[k]:v},sc=score(LED,season,cand);
      const better=sc.seasons.filter((x,i)=>base.seasons[i]&&x.mae<base.seasons[i].mae).length;
      const t={param:k,from:cur[k],to:v,mae:+sc.mae.toFixed(4),gain:+(base.mae-sc.mae).toFixed(4),better};tried.push(t);
      if(!best||sc.mae<best.sc.mae)best={t,cand,sc};}}
  const ok=best&&best.t.gain>=GATE.minImprove&&best.t.better>=GATE.minSeasonsImproved;
  const cfg={};for(const k of PM.TUNABLE)cfg[k]=(ok?best.cand:cur)[k];
  const entry={date:today,baseMae:+base.mae.toFixed(4),best:best?best.t:null,adopted:!!ok};
  const history=[...((prev&&prev.history)||[]),entry].slice(-52);
  return {schema:1,version:VERSION,gate:GATE,lastRun:today,cfg,history,tried};
}
module.exports={VERSION,GATE,STEP,score,tune};
