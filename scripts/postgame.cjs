'use strict';
/* 賽後自動檢討(postgame-v1):比賽結束後,用自有 box score 找出「實際分差和預測差在哪」。
   只做事後說明,不回頭改任何預測;每項附估計影響分數(主隊角度,正 = 對主隊有利)。
   - 三分/罰球手感:本場命中數 − 依該隊本季(本場之前)命中率預期的命中數,換算分數
   - 臨時缺陣:近 5 場平均上場 ≥ 20 分鐘、賽前傷兵名單沒列,本場卻沒上場
   - 原列傷兵卻上場:賽前列為缺陣/存疑,本場上場 ≥ 15 分鐘
   - 個人爆發:得分比自己近 10 場平均多 15 分以上
   - 失誤:兩隊失誤差距 ≥ 8
   - 垃圾時間:三節打完差距 ≥ 20 分 */
const VERSION='postgame-v1';
const sp=v=>{const [a,b]=String(v||'0-0').split('-').map(Number);return [a||0,b||0];};
const num=v=>{const n=+String(v==null?'':v).replace('+','');return Number.isFinite(n)?n:0;};
function teamLine(bx){
  const rows=(bx&&bx.p||[]).filter(r=>r.length>4),t={p3m:0,p3a:0,ftm:0,fta:0,to:0,players:[]};
  for(const r of rows){const [m3,a3]=sp(r[6]),[mf,af]=sp(r[7]);t.p3m+=m3;t.p3a+=a3;t.ftm+=mf;t.fta+=af;t.to+=num(r[10]);
    t.players.push({id:+r[0],min:num(r[3]),pts:num(r[4])});}
  t.played=new Set(t.players.filter(x=>x.min>0).map(x=>x.id));
  return t;
}
/* 該隊本季、本場之前的命中率與每位球員近況 */
function teamHistory(prior,tid){
  let p3m=0,p3a=0,ftm=0,fta=0;const byP={},games=[];
  for(const e of prior){const side=e.hid===tid?'h':e.aid===tid?'a':null;if(!side||!e.bx||!e.bx[side])continue;
    const t=teamLine(e.bx[side]);p3m+=t.p3m;p3a+=t.p3a;ftm+=t.ftm;fta+=t.fta;games.push(t);}
  for(const t of games.slice(-10))for(const x of t.players){(byP[x.id]=byP[x.id]||{pts:[],min:[]});byP[x.id].pts.push(x.pts);}
  for(const t of games.slice(-5))for(const x of t.players){(byP[x.id]=byP[x.id]||{pts:[],min:[]});byP[x.id].min.push(x.min);}
  /* 近 5 場沒出現的場次以 0 分鐘計 */
  const last5=games.slice(-5).length;
  for(const id in byP){const p=byP[id];while(p.min.length<last5)p.min.push(0);}
  return {p3:p3a>=60?p3m/p3a:null,ft:fta>=40?ftm/fta:null,n:games.length,byP};
}
const nameIn=(list,name)=>Array.isArray(list)&&name&&list.some(s=>String(s).startsWith(name+'(')||String(s).startsWith(name+' ('));
function explain(e,prior,pre,names,league){
  if(!e||!e.bx||!e.bx.h||!e.bx.a||!Number.isFinite(e.am))return null;
  const out=[],nm=id=>(names&&names[id]&&names[id].n)||null;
  const sides=[['h',e.hid,1,e.hm],['a',e.aid,-1,e.aw]];
  const short=n=>{const m=/(Trail Blazers|Timberwolves|76ers|[A-Za-z]+)$/.exec(String(n||''));return m?m[1]:n;};
  for(const [sd,tid,sg,team] of sides){
    const t=teamLine(e.bx[sd]),H=teamHistory(prior,tid),T=short(team);
    const p3=H.p3??league.p3,ft=H.ft??league.ft;
    if(t.p3a>=10&&p3){const extra=t.p3m-t.p3a*p3,pts=extra*3;
      if(Math.abs(pts)>=6)out.push({k:'三分',v:+(sg*pts).toFixed(1),s:`${T} 三分 ${t.p3a} 投 ${t.p3m} 中(${Math.round(t.p3m/t.p3a*100)}%),比本季平均 ${Math.round(p3*100)}% ${extra>0?'多':'少'}進 ${Math.abs(extra).toFixed(1)} 球,約 ${extra>0?'+':'−'}${Math.abs(pts).toFixed(0)} 分`});}
    if(t.fta>=8&&ft){const extra=t.ftm-t.fta*ft;
      if(Math.abs(extra)>=4)out.push({k:'罰球',v:+(sg*extra).toFixed(1),s:`${T} 罰球 ${t.fta} 罰 ${t.ftm} 中,比平常${extra>0?'多':'少'}進 ${Math.abs(extra).toFixed(0)} 球`});}
    const preList=pre?(sd==='h'?pre.hn:pre.an):null;
    for(const id in H.byP){const p=H.byP[id],n=nm(id);if(!n||!p.min.length)continue;
      const avgMin=p.min.reduce((a,b)=>a+b,0)/p.min.length,avgPts=p.pts.length?p.pts.reduce((a,b)=>a+b,0)/p.pts.length:0;
      if(avgMin>=20&&!t.played.has(+id)&&!nameIn(preList,n))out.push({k:'臨時缺陣',v:+(-sg*Math.min(6,avgPts*0.25)).toFixed(1),s:`${T} ${n}(近況場均 ${avgPts.toFixed(0)} 分、${avgMin.toFixed(0)} 分鐘)賽前名單沒列,卻沒有上場`});}
    for(const x of t.players){const n=nm(x.id);if(!n||x.min<15)continue;
      if(nameIn(preList,n))out.push({k:'意外出賽',v:+(sg*2).toFixed(1),s:`${T} ${n} 賽前列在傷兵名單,結果上場 ${x.min} 分鐘、得 ${x.pts} 分`});
      const p=H.byP[x.id];if(p&&p.pts.length>=4){const avg=p.pts.reduce((a,b)=>a+b,0)/p.pts.length;
        if(x.pts-avg>=15)out.push({k:'爆發',v:+(sg*Math.min(8,(x.pts-avg)*0.4)).toFixed(1),s:`${T} ${n} 得 ${x.pts} 分,比近 10 場平均 ${avg.toFixed(0)} 分多 ${(x.pts-avg).toFixed(0)} 分`});}}
  }
  const th=teamLine(e.bx.h),ta=teamLine(e.bx.a);
  if(Math.abs(th.to-ta.to)>=8){const more=th.to>ta.to?e.hm:e.aw;out.push({k:'失誤',v:+((ta.to-th.to)*1.1).toFixed(1),s:`${short(more)} 失誤 ${Math.max(th.to,ta.to)} 次,比對手多 ${Math.abs(th.to-ta.to)} 次`});}
  const q=e.ls;if(q&&Array.isArray(q.h)&&Array.isArray(q.a)&&q.h.length>=4){const m3=q.h.slice(0,3).reduce((a,b)=>a+b,0)-q.a.slice(0,3).reduce((a,b)=>a+b,0);
    if(Math.abs(m3)>=20)out.push({k:'垃圾時間',v:0,s:`三節打完已差 ${Math.abs(m3)} 分,第四節多為替補上場,最後分差 ${Math.abs(e.am)} 分有部分是垃圾時間造成`});}
  out.sort((x,y)=>Math.abs(y.v)-Math.abs(x.v));
  const pred=e.pg&&Number.isFinite(e.pg.mm)?e.pg.mm:null;
  return {v:VERSION,miss:pred==null?null:+(e.am-pred).toFixed(1),r:out.slice(0,5)};
}
function leagueRates(games){let p3m=0,p3a=0,ftm=0,fta=0;for(const e of games){for(const sd of ['h','a']){if(!e.bx||!e.bx[sd])continue;const t=teamLine(e.bx[sd]);p3m+=t.p3m;p3a+=t.p3a;ftm+=t.ftm;fta+=t.fta;}}
  return {p3:p3a?p3m/p3a:0.36,ft:fta?ftm/fta:0.78};}
module.exports={VERSION,explain,leagueRates,teamLine};
