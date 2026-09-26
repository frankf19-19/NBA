/*
  NBA 預測計分板 — 雲端每日校準腳本
  Copyright (c) 2026 frankf19-19. All Rights Reserved.

  設計原則:雲端「不複製」模型——直接在 jsdom 中載入本 repo 的 index.html,呼叫網頁本身的
  samplesForDate / predict / bestK / bestSigma / learnInjFactor / buildPDB,
  因此網頁模型怎麼改,雲端校準就自動跟著一樣,永不漂移。

  產出:
    calib.json       K、σ、缺陣係數、校準履歷、精簡紀錄簿(供所有裝置共用)
    seed-ledger.json 完整紀錄簿(含每場兩隊上場球員數據),雲端持續累積的學習資料
    pdb.json         全聯盟球員資料庫(30 隊全名單 + 本季數據)

  鐵律:紀錄簿只新增、不改寫——每場預測一旦寫入就凍結;逐日依時間順序處理,
  逐隊偏差只看當日之前的紀錄,回補也不偷看未來。
*/
const fs=require('fs');
const path=require('path');
const {JSDOM,VirtualConsole}=require('jsdom');

const ROOT=path.resolve(__dirname,'..');
const F_CALIB=path.join(ROOT,'calib.json');
const F_SEED=path.join(ROOT,'seed-ledger.json');
const F_PDB=path.join(ROOT,'pdb.json');
const FIT_DAYS=60;        // K/σ 擬合窗口(以最後一個有比賽的日期往回算)
const HIST_MAX=120;
const PL_BATCH=6;         // box score 併發數

/* ---------- 網路(可注入模擬器做離線測試) ---------- */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let NET=null;
if(process.env.NBA_MOCK)NET=require(path.resolve(process.env.NBA_MOCK));
async function netFetch(url){
  url=String(url);
  if(NET)return NET(url);
  for(let i=0;i<4;i++){
    try{
      const r=await fetch(url,{headers:{'User-Agent':'nba-scoreboard-calib/1.5'},signal:AbortSignal.timeout(20000)});
      if(r.status===404)return r;
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r;
    }catch(e){if(i===3)throw e;await sleep(1500*(i+1));}
  }
}
const readJSON=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return d;}};
function etToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function shiftDate(d,n){const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);}
const slim=e=>{const o={id:e.id,d:e.d,aw:e.aw,hm:e.hm,hid:e.hid,aid:e.aid,m:e.m,am:e.am,hit:e.hit};if(e.st!=null)o.st=e.st;if(e.po)o.po=1;return o;};

(async()=>{
  const t0=Date.now();
  const today=process.env.NBA_TODAY||etToday();
  const yday=shiftDate(today,-1);
  const prev=readJSON(F_CALIB,{});
  let LED=readJSON(F_SEED,null)||prev.ledger||[];

  /* ---------- 自我檢查:去重、移除損壞紀錄 ---------- */
  let fixed=0;
  {const seen=new Set(),out=[];
    for(const e of LED){
      if(!e||!e.id||seen.has(e.id)||!Number.isFinite(e.m)||!Number.isFinite(e.am)||!/^\d{4}-\d\d-\d\d$/.test(e.d||'')){fixed++;continue;}
      seen.add(e.id);out.push(e);}
    LED=out.sort((a,b)=>a.d.localeCompare(b.d));}

  /* ---------- 載入網頁本身(雲端建置模式:不自動執行畫面流程) ---------- */
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(!/Not implemented/.test(String(e&&e.message)))console.error('[jsdom]',e.message);});
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://frankf19-19.github.io/NBA/',virtualConsole:vc,
    beforeParse(w){
      w.__CLOUD_BUILD=true;
      w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},fillRect(){},
        createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),ellipse(){}});
      w.matchMedia=()=>({matches:true,addListener(){},removeListener(){}});
      w.requestAnimationFrame=()=>0;w.cancelAnimationFrame=()=>{};
      w.scrollTo=()=>{};
      w.fetch=async u=>{const r=await netFetch(u);return {ok:r.ok,status:r.status,json:()=>r.json()};};
    }});
  const W=dom.window,E=x=>W.eval(x);
  if(typeof W.samplesForDate!=='function'||typeof W.predict!=='function')throw new Error('index.html 缺少 samplesForDate/predict,無法校準');
  if(isFinite(prev.k)&&isFinite(prev.sigma))E(`MARGIN_K=${+prev.k};RUN_SIGMA=${+prev.sigma};`);
  const setLS=()=>W.localStorage.setItem('nba_ledger',JSON.stringify(LED.map(slim)));
  setLS();

  /* ---------- 1) 逐日回補(依時間順序,只新增不改寫) ---------- */
  const seasonNow=+E(`seasonOf('${today}')`);
  const lastD=LED.length?LED[LED.length-1].d:null;
  const from=process.env.BOOT_FROM||(lastD?shiftDate(lastD,-2):`${seasonNow-2}-10-15`);
  const bootstrap=!lastD;
  const have=new Set(LED.map(e=>e.id));
  let added=0,errors=0,days=0;
  for(let d=from;d<=yday;d=shiftDate(d,1)){
    days++;
    try{
      const r=await W.samplesForDate(d);
      const fresh=[...r.samples].filter(x=>x.st!==1&&!have.has(x.id)).map(x=>({
        id:String(x.id),d:x.d,aw:x.aw,hm:x.hm,hid:x.hid,aid:x.aid,st:x.st,po:x.po?1:0,
        m:+(+x.m).toFixed(2),am:x.actM,hit:((x.m>=0)===x.homeWon)?1:0}));
      if(fresh.length){fresh.forEach(e=>{have.add(e.id);LED.push(e);});added+=fresh.length;setLS();
        console.log(`${d}  +${fresh.length} 場(累計 ${LED.length})`);}
    }catch(e){errors++;console.error(d,'失敗:',e.message);}
  }
  console.log(`回補 ${days} 天,新增 ${added} 場,錯誤 ${errors}`);

  /* ---------- 2) 每場兩隊上場球員數據(box score) ---------- */
  const todo=LED.filter(e=>!e.pl);
  let plN=0;
  for(let i=0;i<todo.length;i+=PL_BATCH){
    await Promise.all(todo.slice(i,i+PL_BATCH).map(async e=>{
      try{const r=W.parsePlayerLines(await W.jget(`${E('SB')}/summary?event=${e.id}`));
        if(r){e.pl=JSON.parse(JSON.stringify(r.pl));e.hid=r.hid;e.aid=r.aid;plN++;}}catch(err){}
    }));
    if(i&&i%120===0)console.log(`球員數據 ${i}/${todo.length}`);
  }
  console.log(`球員數據新增 ${plN} 場`);

  /* ---------- 3) 擬合 K / σ(例行賽、最近 FIT_DAYS 天,含阻尼;首次回補多輪收斂) ---------- */
  const reg=LED.filter(e=>!e.po);
  const fitEnd=reg.length?reg[reg.length-1].d:null;
  const win=fitEnd?reg.filter(e=>e.d>shiftDate(fitEnd,-FIT_DAYS)):[];
  const samples=win.map(e=>({m:e.m,actM:e.am,homeWon:e.am>0}));
  let hit=null;
  if(samples.length>=30){
    const rounds=bootstrap?6:1;
    for(let i=0;i<rounds;i++){
      const nk=W.bestK(samples);E(`MARGIN_K=${nk}`);
      const b=W.bestSigma(samples,nk);E(`RUN_SIGMA=${b.best}`);
    }
    hit=E('hitRateOf')(samples);
  }
  const K=+(+E('MARGIN_K')).toFixed(2),S=+(+E('RUN_SIGMA')).toFixed(2);

  /* ---------- 4) 主力缺陣係數(由完整紀錄簿學習) ---------- */
  const inj=JSON.parse(JSON.stringify(W.learnInjFactor(LED)));

  /* ---------- 5) 全聯盟球員資料庫 ---------- */
  let pdbN=0;
  try{
    await W.buildPDB();
    const pdb=JSON.parse(JSON.stringify(E('PDB')));
    pdbN=Object.keys(pdb.players||{}).length;
    if(pdbN>=200)fs.writeFileSync(F_PDB,JSON.stringify(pdb));
  }catch(e){console.error('球員資料庫失敗:',e.message);}

  /* ---------- 6) 輸出 ---------- */
  const hist=(prev.hist||[]).filter(h=>h.d!==today);
  if(hit!=null)hist.push({d:today,s:S,k:K,hit:+(hit*100).toFixed(1),n:samples.length});
  while(hist.length>HIST_MAX)hist.shift();
  const health={games:LED.length,reg:reg.length,po:LED.length-reg.length,withPl:LED.filter(e=>e.pl).length,
    fixed,added,errors,fitN:samples.length,pdb:pdbN,secs:Math.round((Date.now()-t0)/1000)};
  const calib={k:K,sigma:S,injF:inj.f,inj,hist,ledger:LED.map(slim),
    last:LED.length?LED[LED.length-1].d:null,updated:new Date().toISOString(),window:FIT_DAYS,health};
  fs.writeFileSync(F_CALIB,JSON.stringify(calib));
  fs.writeFileSync(F_SEED,JSON.stringify(LED));
  console.log('完成:',JSON.stringify({k:K,sigma:S,injF:inj.f,hit:hit!=null?+(hit*100).toFixed(1):null,...health}));
  dom.window.close();
  process.exit(0);
})().catch(e=>{console.error('校準失敗:',e);process.exit(1);});
