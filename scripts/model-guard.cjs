'use strict';
/* 正式模型自動把關(事先寫死的規則,不可事後調整門檻):
   比較「正式新模型(quality)」與「舊版基礎公式」在同一場、同一次賽前凍結預測的勝分差絕對誤差。
   - 只用已完賽、正規賽、非中立場、已凍結(pg.u===2)且兩種分差都有的場次;不含任何賽後資訊。
   - 以「比賽日」為單位平均(同一天的比賽彼此相關),算日平均差的 t 值。
   - 累積滿 30 個比賽日且 300 場才判斷;t ≥ 2(正式模型明顯較差)→ 改用舊版公式;
     已改用舊版後,t ≤ 0.5 才換回正式模型(避免來回切換)。 */
const RULE={minDates:30,minGames:300,switchT:2,backT:0.5,version:'model-guard-v1'};
const pickQuality=e=>Number.isFinite(e.pg.baseMargin)&&(Number.isFinite(e.pg.qm)||(e.pg.qv&&Number.isFinite(e.pg.mm)))?{formal:Number.isFinite(e.pg.qm)?e.pg.qm:e.pg.mm,base:e.pg.baseMargin}:null;
const pickPlayer=e=>Number.isFinite(e.pg.pmm)&&Number.isFinite(e.pg.pm0)?{formal:e.pg.pmm,base:e.pg.pm0}:null;
function rows(LED,fromSeason,pick=pickQuality){
  return LED.filter(e=>e&&e.sy>=fromSeason&&e.st===2&&!e.po&&!e.nu&&!e.nm&&Number.isFinite(e.am)&&e.pg&&e.pg.u===2&&pick(e))
    .map(e=>{const {formal,base}=pick(e);return {d:e.d,formal,base,diff:Math.abs(e.am-formal)-Math.abs(e.am-base)};});
}
function evaluate(LED,prev,fromSeason){
  const q=judge(rows(LED,fromSeason,pickQuality),prev);
  const pl=judge(rows(LED,fromSeason,pickPlayer),prev&&prev.player?{mode:prev.player.mode==='off'?'base':'formal',changedAt:prev.player.changedAt}:null);
  q.fromSeason=fromSeason;q.player={mode:pl.mode==='base'?'off':'on',reason:pl.reason.replace('改用舊版公式','關閉球員層').replace('維持舊版公式','維持關閉球員層').replace('換回正式模型','重新啟用球員層').replace(/正式模型/g,'球員層'),dates:pl.dates,games:pl.games,meanDiff:pl.meanDiff,t:pl.t,changedAt:pl.changedAt};
  return q;
}
function judge(R,prev){
  const by={};R.forEach(r=>{(by[r.d]=by[r.d]||[]).push(r.diff);});
  const days=Object.values(by).map(a=>a.reduce((x,y)=>x+y,0)/a.length),D=days.length,n=R.length;
  const mean=D?days.reduce((x,y)=>x+y,0)/D:null;
  const sd=D>1?Math.sqrt(days.reduce((x,y)=>x+(y-mean)**2,0)/(D-1)):null;
  const t=sd>0?mean/(sd/Math.sqrt(D)):null;
  const prevMode=prev&&prev.mode==='base'?'base':'formal';
  let mode=prevMode,reason='樣本未達門檻,維持正式模型';
  if(D>=RULE.minDates&&n>=RULE.minGames&&t!=null){
    if(prevMode==='formal'&&t>=RULE.switchT){mode='base';reason='正式模型誤差明顯較大,改用舊版公式';}
    else if(prevMode==='base'&&t<=RULE.backT){mode='formal';reason='正式模型已追上,換回正式模型';}
    else reason=mode==='base'?'維持舊版公式(正式模型尚未追上)':'正式模型未明顯較差,維持';
  }else if(prevMode==='base')reason='維持舊版公式';
  return {schema:1,version:RULE.version,rule:RULE,mode,reason,dates:D,games:n,
    meanDiff:mean==null?null:+mean.toFixed(3),t:t==null?null:+t.toFixed(2),
    changedAt:mode!==prevMode?new Date().toISOString():(prev&&prev.changedAt)||null};
}
module.exports={RULE,rows,evaluate,pickPlayer,pickQuality};
