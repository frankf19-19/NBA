/*
  NBA 預測計分板 — 雲端每日校準腳本
  Copyright (c) 2026 frankf19-19. All Rights Reserved.

  設計原則:雲端「不複製」模型——直接在 jsdom 中載入本 repo 的 index.html,呼叫網頁本身的
  samplesForDate / predict / bestK / bestSigma / learnInjFactor / buildPDB,
  因此網頁模型怎麼改,雲端校準就自動跟著一樣,永不漂移。

  產出:
    calib.json            K、σ、缺陣係數、校準履歷、歷年回測、近期精簡紀錄簿(供所有裝置共用)
    seed/ledger-YYYY.json 完整紀錄簿,每個賽季一個檔(含每場兩隊上場球員數據),1994-95 季起
                          已結束的賽季寫完即封存,只有當季檔案每天變動,避免 repo 膨脹
    seed/meta.json        各賽季回補完成狀態
    pdb.json              全聯盟球員資料庫(30 隊全名單 + 本季數據)

  鐵律:紀錄簿只新增、不改寫——每場預測一旦寫入就凍結;逐日依時間順序處理,
  逐隊偏差只看當日之前的紀錄,回補也不偷看未來。
*/
const fs=require('fs');
const path=require('path');
const {JSDOM,VirtualConsole}=require('jsdom');
/* 版本:v2.1(勝分差區間機率表與全中回測)v2.0(自有資料庫:完整 box score/各節比分/每日傷兵、戰績、新聞快照/球員資料庫週快照/賽前含傷兵預測,並由賽前傷兵學係數)v1.9(掃描前先套學習參數、輸出各季開幕日 ssMap)v1.8(季內時間刻度、傷兵係數不再拉回 0.35)v1.7.2(K/σ 改用兩季窗口、逐隊偏差需驗證才啟用)v1.7.1(休息天數美東日期修正)v1.7(參數學習 + 攻守效率 + 公平回測)v1.6.3(同場重複登錄去重、賽季依日期推算、收錄無預測場次) 1994-95 季起全部賽季(不用 localStorage) + 失敗日期重試 + 排除表演賽與空殼場次 */

const ROOT=path.resolve(__dirname,'..');
const F_CALIB=path.join(ROOT,'calib.json');
const F_SEED_OLD=path.join(ROOT,'seed-ledger.json');   // v1.5 舊格式,首次執行自動拆分後移除
const D_SEED=path.join(ROOT,'seed');
const F_META=path.join(D_SEED,'meta.json');
const FIRST_SEASON=+(process.env.FIRST_SEASON||1995);   // 1994-95 賽季起(ESPN 完整資料的最早賽季)
const CLIENT_LEDGER=1500;                                // 網頁端只需近期紀錄(逐隊偏差看每隊最近 12 場)
const BUBBLE=['2020-07-30','2020-10-12'];                // 2020 泡泡園區:中立場
const F_PDB=path.join(ROOT,'pdb.json');
const FIT_DAYS=60;        // K/σ 擬合窗口(以最後一個有比賽的日期往回算)
const HIST_MAX=120;
const PL_BATCH=8;         // box score 併發數
const BX_PER_RUN=+(process.env.BX_PER_RUN||2500);   // 每次執行回補完整原始資料的歷史場次上限(約 3~4 分鐘)
const PDB_SNAP_DAYS=7;    // 球員資料庫快照間隔(天)

/* ---------- 網路(可注入模擬器做離線測試) ---------- */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let NET=null;
if(process.env.NBA_MOCK)NET=require(path.resolve(process.env.NBA_MOCK));
async function netFetch(url){
  url=String(url);
  if(NET)return NET(url);
  for(let i=0;i<4;i++){
    try{
      const r=await fetch(url,{headers:{'User-Agent':'nba-scoreboard-calib/1.9'},signal:AbortSignal.timeout(20000)});
      if(r.status===404)return r;
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r;
    }catch(e){if(i===3)throw e;await sleep(1500*(i+1));}
  }
}
const readJSON=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return d;}};
function etToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function shiftDate(d,n){const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);}
const slim=e=>{const o={id:e.id,d:e.d,sy:e.sy,aw:e.aw,hm:e.hm,hid:e.hid,aid:e.aid,m:e.m,am:e.am,hit:e.hit};if(e.mb!=null){o.mb=e.mb;o.mbh=e.mbh;}if(e.mp!=null)o.mp=e.mp;if(e.ts)o.ts=e.ts;if(e.st!=null)o.st=e.st;if(e.po)o.po=1;if(e.nu)o.nu=1;if(e.nm)o.nm=1;return o;};
/* 依日期插入(保持紀錄簿時間順序,逐隊偏差才不會看錯場次) */
function insertSorted(arr,e){let lo=0,hi=arr.length;while(lo<hi){const mid=(lo+hi)>>1;if(arr[mid].d<=e.d)lo=mid+1;else hi=mid;}arr.splice(lo,0,e);}

(async()=>{
  const t0=Date.now();
  const today=process.env.NBA_TODAY||etToday();
  const yday=shiftDate(today,-1);
  const prev=readJSON(F_CALIB,{});
  if(!fs.existsSync(D_SEED))fs.mkdirSync(D_SEED);
  const meta=readJSON(F_META,{seasons:{}});
  /* 紀錄簿規則版本:v2 = 賽季依日期推算 + 收錄無法預測的比賽(nm)。版本升級時所有賽季重掃一次,已收錄場次自動略過 */
  const LEDGER_V=4;   /* v3 = 每場補記預測成分 f 與球隊數據 ts;v4 = 休息天數改用美東日期後重算成分 */
  const prevV=meta.v||1;
  const upgrading=prevV<LEDGER_V;
  if(upgrading){for(const k of Object.keys(meta.seasons)){meta.seasons[k].complete=false;delete meta.seasons[k].fail;}meta.v=LEDGER_V;console.log('紀錄簿規則升級至 v'+LEDGER_V+':全部賽季重掃一次');}
  let LED=[];
  for(const f of fs.readdirSync(D_SEED)){if(/^ledger-\d{4}\.json$/.test(f))LED=LED.concat(readJSON(path.join(D_SEED,f),[]));}
  /* 賽前預測檔(本季):每場開打前記下含當日傷兵的預測,開打後凍結;入紀錄簿時附在 pg */
  const seasonNow0=(+today.slice(5,7)>=8)?+today.slice(0,4)+1:+today.slice(0,4);
  const F_PRE=path.join(D_SEED,`pregame-${seasonNow0}.json`);
  const PRE=readJSON(F_PRE,{});
  if(fs.existsSync(F_SEED_OLD)){LED=LED.concat(readJSON(F_SEED_OLD,[]));}
  else if(!LED.length&&Array.isArray(prev.ledger))LED=prev.ledger.slice();

  /* ---------- 自我檢查:去重、移除損壞紀錄 ---------- */
  let fixed=0;
  {const seen=new Set(),seenKey=new Set(),out=[];
    for(const e of LED){
      if(!e||!e.id||seen.has(e.id)||!Number.isFinite(e.m)||!Number.isFinite(e.am)||
        !(e.hid>=1&&e.hid<=30&&e.aid>=1&&e.aid<=30)||   /* 全明星賽等表演賽 */
        e.am===0||   /* NBA 無和局:0 分差代表缺比分空殼 */
!/^\d{4}-\d\d-\d\d$/.test(e.d||'')){fixed++;continue;}
      if(!e.sy)e.sy=(+e.d.slice(5,7)>=8)?+e.d.slice(0,4)+1:+e.d.slice(0,4);
      if(e.hs==null&&e.ts&&e.ts.h&&e.ts.a){e.hs=e.ts.h[0];e.as=e.ts.a[0];}   /* 終場比分:舊資料由球隊數據補回 */
      if(e.d>=BUBBLE[0]&&e.d<BUBBLE[1]){e.sy=2020;e.nu=1;}
      const gk=e.d+'|'+e.hid+'|'+e.aid;   /* ESPN 偶有同一場比賽登錄兩次(不同編號),同日同主客組合只留一筆 */
      if(seenKey.has(gk)){fixed++;continue;}
      seenKey.add(gk);seen.add(e.id);out.push(e);}
    LED=out.sort((a,b)=>a.d.localeCompare(b.d));}
  /* v4:成分 f 以修正後的休息天數重算(f 是給學習用的衍生資料;當時的預測 m/am/hit 仍凍結不動) */
  if(prevV<4){LED.forEach(e=>{delete e.f;delete e.mp;});console.log('成分 f 全部重算(休息天數改用美東日期)');}

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
  /* 掃描新場次前先套上目前生效的學習參數:紀錄簿凍結的 m 才會等於網站當天真正顯示的預測
     (舊版掃描時仍是寫死的預設參數,m 與網站不一致;mp 另以最新參數重算,不受影響) */
  if(prev.prm&&isFinite(prev.prm.hca))E(`Object.assign(PRM,${JSON.stringify(prev.prm)});PRM.src='cloud';`);
  if(prev.mb&&Array.isArray(prev.mb.g))E(`MB=${JSON.stringify(prev.mb)}`);   /* 勝分差區間機率表(昨日學得),新場次的區間預測據此凍結 */
  /* 紀錄簿不放 localStorage(上限 500 萬字元,數萬場會爆):
     預測某日時,把「該日之前最近 3,000 場」直接交給網頁的 ledger(),逐隊偏差只需每隊最近 12 場,且不偷看未來 */
  let CUR=[];
  W.ledger=()=>CUR;
  const before=d=>{let lo=0,hi=LED.length;while(lo<hi){const mid=(lo+hi)>>1;if(LED[mid].d<d)lo=mid+1;else hi=mid;}return lo;};
  const setCur=d=>{const i=before(d);CUR=LED.slice(Math.max(0,i-3000),i);};

  /* ---------- 0) 球員數據 + 球隊數據(box score);掃描前先補,攻守效率才有資料可用 ---------- */
  /* 每場 box score 寫入紀錄簿:精簡版(pl/ts,模型學習用)+ 完整原始版(bx 全員全欄位、tst 球隊全部統計、ls 各節比分、hs/as 終場比分、場館/觀眾/開球時間)
     ——完整版是我們自己的資料庫,不依賴 ESPN 日後還留不留 */
  const applyBox=(e,r0)=>{const r=JSON.parse(JSON.stringify(r0));
    if(!e.pl)e.pl=r.pl;if(r.hid>=1&&r.hid<=30&&r.aid>=1&&r.aid<=30){e.hid=r.hid;e.aid=r.aid;}
    if(r.ts)e.ts=r.ts;else e.tsx=1;
    if(r.bx)e.bx=r.bx;else e.bxx=1;
    for(const k of ['tst','ls','hs','as','ven','att','tip'])if(r[k]!=null)e[k]=r[k];};
  const fetchBox=async(label,list)=>{
    const todo=list||LED.filter(e=>(!e.pl||!e.ts)&&!e.tsx);
    let n=0;
    for(let i=0;i<todo.length;i+=PL_BATCH){
      await Promise.all(todo.slice(i,i+PL_BATCH).map(async e=>{
        try{const r=W.parsePlayerLines(await W.jget(`${E('SB')}/summary?event=${e.id}`));
          if(r){applyBox(e,r);n++;}
          else{e.tsx=1;e.bxx=1;}}catch(err){}
      }));
      if(i&&i%1200===0)console.log(`${label} ${i}/${todo.length}`);
    }
    console.log(`${label}:處理 ${n}/${todo.length} 場`);
  };
  await fetchBox('box score(掃描前)');
  /* 歷史場次補齊完整原始資料:每次最多 BX_PER_RUN 場,由新到舊,幾週內自動補完 1994-95 季起全部 */
  {const bk=LED.filter(e=>!e.bx&&!e.bxx).sort((a,b)=>b.d.localeCompare(a.d)).slice(0,BX_PER_RUN);
    if(bk.length)await fetchBox(`完整原始資料回補(剩 ${LED.filter(e=>!e.bx&&!e.bxx).length} 場)`,bk);}

  /* ---------- 1) 逐季、逐日回補(依時間順序,只新增不改寫;已封存賽季略過) ---------- */
  const seasonNow=+E(`seasonOf('${today}')`);
  let bootstrap=!LED.length;
  const have=new Set(LED.map(e=>e.id));
  const haveKey=new Set(LED.map(e=>e.d+'|'+e.hid+'|'+e.aid));
  const byId=new Map(LED.map(e=>[String(e.id),e]));
  let fAdded=0;
  let added=0,errors=0,days=0;
  for(let sy=FIRST_SEASON;sy<=seasonNow;sy++){
    const m=meta.seasons[sy]||{};
    if(m.complete)continue;
    const retry=Array.isArray(m.fail)?m.fail.slice():[];
    const inSeason=LED.filter(e=>e.sy===sy);
    const lastInS=inSeason.length?inSeason[inSeason.length-1].d:null;
    const endWin=`${sy}-10-15`;
    /* 已結束卻未封存、且沒有失敗清單(舊版執行留下的):整季重掃一次,已收錄場次自動略過 */
    const rescan=endWin<yday&&m.games&&!Array.isArray(m.fail);
    const start=process.env.BOOT_FROM||((lastInS&&!rescan&&!upgrading)?shiftDate(lastInS,-2):`${sy-1}-10-01`);
    const end=endWin<yday?endWin:yday;
    const dates=[...retry];
    for(let d=start;d<=end;d=shiftDate(d,1))if(!dates.includes(d))dates.push(d);
    if(!dates.length){continue;}
    let sErr=0,sAdd=0;const fail=[];
    console.log(`== ${sy-1}-${String(sy).slice(2)} 賽季:${start} → ${end}${retry.length?`(另重試上次失敗 ${retry.length} 天)`:''}`);
    const runDay=async d=>{
      days++;
      try{
        setCur(d);
        const r=await W.samplesForDate(d);
        for(const x of r.samples){const ex=byId.get(String(x.id));if(ex&&!ex.f&&x.f){ex.f=JSON.parse(JSON.stringify(x.f));fAdded++;}}
        const fresh=[...r.samples].filter(x=>x.st!==1&&(x.sy||sy)===sy&&!have.has(String(x.id))&&!haveKey.has(x.d+'|'+x.hid+'|'+x.aid)).map(x=>{
          const e={id:String(x.id),d:x.d,sy:x.sy||sy,aw:x.aw,hm:x.hm,hid:x.hid,aid:x.aid,st:x.st,po:x.po?1:0,
            m:+(+x.m).toFixed(2),am:x.actM,hit:x.nm?null:(((x.m>=0)===x.homeWon)?1:0)};
          if(x.mb!=null){e.mb=x.mb;e.mbp=x.mbp;e.mbh=(W.mbActualIdx(x.actM)===x.mb)?1:0;}   /* 勝分差區間預測與是否全中,凍結 */
          if(x.nm)e.nm=1;
          if(x.f)e.f=JSON.parse(JSON.stringify(x.f));
          if(e.d>=BUBBLE[0]&&e.d<BUBBLE[1])e.nu=1;
          if(x.hs!=null){e.hs=x.hs;e.as=x.as;}
          const pg=PRE[e.id];if(pg&&pg.m!=null)e.pg={m:pg.m,ih:pg.ih,ia:pg.ia,f:pg.f,p:pg.p,k:pg.k,s:pg.s,at:pg.at};   /* 賽前(含當日傷兵)預測,凍結 */
          return e;});
        if(fresh.length){fresh.forEach(e=>{have.add(e.id);haveKey.add(e.d+'|'+e.hid+'|'+e.aid);insertSorted(LED,e);byId.set(e.id,e);});added+=fresh.length;sAdd+=fresh.length;}
        return true;
      }catch(e){console.error(d,'失敗:',e.message);return false;}
    };
    for(const d of dates){days++;if(!(await runDay(d)))fail.push(d);}
    /* 本次失敗的日期:稍候再重試一輪(ESPN 偶發 502) */
    if(fail.length){await sleep(8000);
      for(const d of fail.splice(0)){if(!(await runDay(d)))fail.push(d);}}
    sErr=fail.length;errors+=sErr;
    const n=LED.filter(e=>e.sy===sy).length;
    meta.seasons[sy]={complete:(endWin<yday&&sErr===0&&n>0),games:n,checked:today,fail};
    console.log(`   新增 ${sAdd} 場,本季共 ${n} 場,錯誤 ${sErr}${sErr?`(${fail.join(', ')},下次優先重試)`:''}${meta.seasons[sy].complete?',已封存':''}`);
  }
  console.log(`回補 ${days} 天,新增 ${added} 場,補記成分 ${fAdded} 場,錯誤 ${errors},紀錄簿共 ${LED.length} 場`);

  /* ---------- 2) 新增場次的 box score ---------- */
  await fetchBox('box score(新增場次)');

  /* ---------- 2.5) 參數學習與公平回測 ---------- */
  const DEF={hca:2.6,b2b:-1.6,r34:0.3,r5:-0.4,g4:-0.8,mo4:0.6,mo2:0.25,h2h:0.15,h2hCap:0.45};
  const XN=['b2b','r34','r5','g4','mo4','mo2','h2h'];
  const baseOf=(e,v)=>v==='eff'?(e.f.be!=null?e.f.be:e.f.b):e.f.b;
  const preM=(e,prm,v)=>{const x=e.f.x;let m=baseOf(e,v)+prm.hca;
    for(let j=0;j<6;j++)m+=(prm[XN[j]]||0)*x[j];
    m+=Math.max(-prm.h2hCap,Math.min(prm.h2hCap,x[6]*(prm.h2h||0)));return m;};
  function solve(A,bv){const n=A.length;const M=A.map((r,i)=>[...r,bv[i]]);
    for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
      if(Math.abs(M[p][c])<1e-9)return null;[M[c],M[p]]=[M[p],M[c]];
      for(let r=0;r<n;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}
    return M.map((r,i)=>r[n]/r[i]);}
  function ols(rows,cols){ // rows: [{x:[...], y}],cols: 要用的欄位索引
    const k=cols.length,A=Array.from({length:k},()=>new Array(k).fill(0)),bv=new Array(k).fill(0);
    for(const r of rows){for(let a=0;a<k;a++){const xa=r.x[cols[a]];bv[a]+=xa*r.y;for(let b=0;b<k;b++)A[a][b]+=xa*r.x[cols[b]];}}
    const c=solve(A,bv);if(!c)return null;
    let rss=0;for(const r of rows){let p=0;for(let a=0;a<k;a++)p+=c[a]*r.x[cols[a]];rss+=(r.y-p)**2;}
    const s2=rss/Math.max(1,rows.length-k);
    const se=cols.map((_,a)=>{const e=new Array(k).fill(0);e[a]=1;const col=solve(A,e);return col?Math.sqrt(Math.max(0,s2*col[a])):Infinity;});
    return {c,se,t:c.map((v,a)=>v/se[a])};}
  // 設計矩陣:0=基礎實力,1=常數(主場優勢),2..8 = 各項指標(主減客)
  const rowsOf=(list,v)=>list.map(e=>({x:[baseOf(e,v),1,...e.f.x],y:e.am}));
  function fitVariant(list,v){
    const rows=rowsOf(list,v);let cols=[0,1,2,3,4,5,6,7,8];
    for(let it=0;it<8;it++){                     // 反覆剔除不顯著(|t|<2)的指標後重算
      cols=cols.filter(ci=>ci<2||rows.some(r=>r.x[ci]!==0));
      const R=ols(rows,cols);if(!R)return null;
      const drop=cols.map((ci,a)=>({ci,t:R.t[a]})).filter(z=>z.ci>=2&&Math.abs(z.t)<2).sort((a,b)=>Math.abs(a.t)-Math.abs(b.t));
      if(!drop.length){
        const K=R.c[0];if(!(K>0.3))return null;
        const prm={h2hCap:0};const coef={};
        cols.forEach((ci,a)=>{coef[ci]={c:+R.c[a].toFixed(3),t:+R.t[a].toFixed(1)};});
        prm.hca=Math.max(-1,Math.min(6,R.c[cols.indexOf(1)]/K));
        XN.forEach((nm,j)=>{const a=cols.indexOf(j+2);prm[nm]=a<0?0:Math.max(-5,Math.min(5,R.c[a]/K));});
        prm.h2hCap=Math.abs(prm.h2h)*3;
        Object.keys(prm).forEach(k=>prm[k]=+(+prm[k]).toFixed(2));
        return {K,prm,coef};}
      cols=cols.filter(ci=>ci!==drop[0].ci);
    }
    return null;}
  const usable=e=>e.f&&e.f.x&&!e.po&&!e.nu&&!e.nm&&Number.isFinite(e.am);
  const Phi=z=>{const t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2);const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p;};
  function evalSet(test,fn,sig){let ae=0,h=0,br=0;for(const e of test){const pr=fn(e);ae+=Math.abs(e.am-pr);if((pr>=0)===(e.am>0))h++;
      const pw=Math.max(.02,Math.min(.98,Phi(pr/sig)));br+=(pw-(e.am>0?1:0))**2;}
    const n=test.length;return {mae:+(ae/n).toFixed(3),hit:+(h/n*100).toFixed(1),br:+(br/n).toFixed(4),n};}
  const sigOf=(train,fn)=>Math.sqrt(train.reduce((a,e)=>a+(e.am-fn(e))**2,0)/train.length);
  function variants(train){
    const out={};
    const pre0=train.map(e=>preM(e,DEF,'pts'));
    const K0=pre0.reduce((a,p,i)=>a+p*train[i].am,0)/pre0.reduce((a,p)=>a+p*p,0);
    out.old={fn:e=>K0*preM(e,DEF,'pts'),prm:DEF,K:K0};
    for(const v of ['pts','eff']){const F=fitVariant(train,v);if(F)out[v]={fn:e=>F.K*preM(e,F.prm,v),prm:F.prm,K:F.K,coef:F.coef};}
    return out;}
  const US=LED.filter(usable);
  const bySeason={};US.forEach(e=>{(bySeason[e.sy]=bySeason[e.sy]||[]).push(e);});
  const WIN=4,bt=[];
  const doneSeasons=Object.keys(bySeason).map(Number).filter(y=>y<seasonNow).sort((a,b)=>a-b);
  for(const S of doneSeasons.slice(-10)){
    const train=[];for(let y=S-WIN;y<S;y++)if(bySeason[y])train.push(...bySeason[y]);
    const test=bySeason[S]||[];if(train.length<2000||test.length<300)continue;
    const V=variants(train);if(!V.pts||!V.eff)continue;
    const row={s:S,n:test.length};
    for(const k of ['old','pts','eff'])row[k]=evalSet(test,V[k].fn,sigOf(train,V[k].fn));
    bt.push(row);
  }
  const tot={};
  for(const k of ['old','pts','eff']){const n=bt.reduce((a,r)=>a+r.n,0);
    tot[k]={mae:n?+(bt.reduce((a,r)=>a+r[k].mae*r.n,0)/n).toFixed(3):null,hit:n?+(bt.reduce((a,r)=>a+r[k].hit*r.n,0)/n).toFixed(1):null,
      br:n?+(bt.reduce((a,r)=>a+r[k].br*r.n,0)/n).toFixed(4):null};}
  let variant='old';
  if(bt.length>=5){variant=['old','pts','eff'].reduce((b,k)=>tot[k].mae<tot[b].mae-0.005?k:b,'old');}
  // 以最近 4 個完整賽季 + 本季資料學出最終參數
  const finalTrain=[];for(let y=seasonNow-WIN;y<=seasonNow;y++)if(bySeason[y])finalTrain.push(...bySeason[y]);
  let PRMF=Object.assign({},DEF),coefF=null,KF=null;
  if(variant!=='old'&&finalTrain.length>=2000){const F=fitVariant(finalTrain,variant);if(F){PRMF=F.prm;coefF=F.coef;KF=F.K;}else variant='old';}
  PRMF.eff=(variant==='eff');
  /* 季內時間刻度:以較早 5 季學、最近 4 季驗證,有改善才採用;最終以最近 8 季學 */
  const firstD={};US.forEach(e=>{if(!e.po&&(!firstD[e.sy]||e.d<firstD[e.sy]))firstD[e.sy]=e.d;});
  const phOf=e=>{const d=(Date.parse(e.d)-Date.parse(firstD[e.sy]))/864e5;return d<14?0:d<30?1:d<60?2:d<120?3:4;};
  const learnPh=list=>{const K0=list.reduce((a,e)=>a+e.mp0*e.am,0)/list.reduce((a,e)=>a+e.mp0*e.mp0,0);
    return [0,1,2,3,4].map(k=>{const g=list.filter(e=>phOf(e)===k);if(g.length<200)return 1;
      const Kk=g.reduce((a,e)=>a+e.mp0*e.am,0)/g.reduce((a,e)=>a+e.mp0*e.mp0,0);return +Math.max(0.6,Math.min(1.4,Kk/K0)).toFixed(3);});};
  const phVar=variant==='eff'?'eff':'pts';
  US.forEach(e=>{e.mp0=preM(e,PRMF,phVar);});
  const phTrain=US.filter(e=>e.sy>=seasonNow-9&&e.sy<=seasonNow-5),phTest=US.filter(e=>e.sy>=seasonNow-4&&e.sy<seasonNow);
  let phAdopt=false,phEval=null;
  if(phTrain.length>3000&&phTest.length>2000){
    const m=learnPh(phTrain);const Kt=phTrain.reduce((a,e)=>a+e.mp0*e.am,0)/phTrain.reduce((a,e)=>a+e.mp0*e.mp0,0);
    const m0=phTest.reduce((a,e)=>a+Math.abs(e.am-Kt*e.mp0),0)/phTest.length;
    const m1=phTest.reduce((a,e)=>a+Math.abs(e.am-Kt*m[phOf(e)]*e.mp0),0)/phTest.length;
    phEval={train:m,before:+m0.toFixed(3),after:+m1.toFixed(3)};phAdopt=m1<m0-0.005;
  }
  PRMF.ph=phAdopt?learnPh(US.filter(e=>e.sy>=seasonNow-8&&e.sy<seasonNow)):[1,1,1,1,1];
  PRMF.ss=firstD[seasonNow]||null;
  PRMF.ssMap=firstD;   /* 各賽季實際開幕日,網頁回看歷史日期時季內階段才對得上(1998-99 二月開打、2020-21 十二月開打) */
  US.forEach(e=>{delete e.mp0;});
  console.log(`季內時間刻度:${phAdopt?'採用':'不採用'}`,JSON.stringify(PRMF.ph),JSON.stringify(phEval));
  // 歷年主場優勢(每季只用基礎實力 + 常數迴歸)
  const hcaBySeason=Object.keys(bySeason).map(Number).sort((a,b)=>a-b).map(y=>{const R=ols(rowsOf(bySeason[y],'pts'),[0,1]);
    return R&&R.c[0]>0.3?{s:y,v:+R.c[1].toFixed(2)}:null;}).filter(Boolean);   /* 兩隊實力相同時,主隊平均多得幾分 */
  // 現行參數下每場的預期分差 mp(供 K/σ 校準、逐隊偏差與缺陣學習;當時的預測 m 保持凍結不改)
  for(const e of LED){if(e.f&&e.f.x&&!e.nm)e.mp=+preM(e,PRMF,variant==='eff'?'eff':'pts').toFixed(2);else delete e.mp;}
  const prevVar=(prev.fit&&prev.fit.variant)||'old';
  const prmChanged=prevVar!==variant||JSON.stringify(prev.prm||{})!==JSON.stringify(PRMF);
  if(prmChanged&&KF)E(`MARGIN_K=${KF}`);
  E(`Object.assign(PRM,${JSON.stringify(PRMF)})`);
  console.log(`參數學習:採用 ${variant}`,JSON.stringify(PRMF));
  bt.forEach(r=>console.log(`  回測 ${r.s-1}-${String(r.s).slice(2)}  n=${r.n}  原本 ${r.old.mae}/${r.old.hit}%  學習 ${r.pts.mae}/${r.pts.hit}%  效率 ${r.eff.mae}/${r.eff.hit}%`));
  console.log('  合計',JSON.stringify(tot));

  /* ---------- 3) 擬合 K / σ:最近約兩個完整賽季的例行賽(2,500 場),直接求最佳值、不阻尼
     (舊版只用最近 60 天,休賽季時剛好是季末擺爛期,K 被拉高到 1.12、勝率過度自信;
      以 2023-25 學、2025-26 驗證:誤差 11.66→11.43,預測 85% 的比賽實際贏 84%) ---------- */
  const reg=LED.filter(e=>!e.po&&!e.nu&&!e.nm);
  const win=reg.filter(e=>e.mp!=null||Number.isFinite(e.m)).slice(-2500);
  /* 分差刻度與季內時間乘數一起校準 */
  const phM=e=>{if(!PRMF.ph||!firstD[e.sy])return 1;const d=(Date.parse(e.d)-Date.parse(firstD[e.sy]))/864e5;return PRMF.ph[d<14?0:d<30?1:d<60?2:d<120?3:4]||1;};
  const samples=win.map(e=>({m:(e.mp??e.m)*phM(e),actM:e.am,homeWon:e.am>0}));
  let hit=null;
  if(samples.length>=300){
    const Kn=samples.reduce((a,x)=>a+x.m*x.actM,0)/samples.reduce((a,x)=>a+x.m*x.m,0);
    const Kc=Math.max(0.5,Math.min(1.5,Kn));
    let Sb=RUN0(),bb=Infinity;
    for(let sg=8;sg<=16.001;sg+=0.25){const v=E('brierFor')(samples,sg,Kc);if(v<bb){bb=v;Sb=sg;}}
    E(`MARGIN_K=${+Kc.toFixed(3)};RUN_SIGMA=${Sb}`);
    hit=E('hitRateOf')(samples);
  }
  function RUN0(){return +E('RUN_SIGMA');}
  /* 逐隊偏差回饋:以最近三季模擬「開 vs 關」,有降低誤差才啟用 */
  {
    const recent=reg.filter(e=>e.mp!=null&&e.sy>=seasonNow-3);
    const Kc=+E('MARGIN_K');const hist={};let a0=0,a1=0,nb=0;
    for(const e of recent){
      const bias=nm=>{const h=hist[nm]||[];if(h.length<4)return 0;const k=Math.min(12,h.length);const v=h.slice(-k).reduce((s,x)=>s+x,0)/k*0.35;return Math.max(-1.5,Math.min(1.5,v));};
      const base=Kc*e.mp;
      if(e.sy>=seasonNow-2){const adj=(bias(e.hm)-bias(e.aw))/2;a0+=Math.abs(e.am-base);a1+=Math.abs(e.am-(base+adj));nb++;}
      const r=e.am-base;(hist[e.hm]=hist[e.hm]||[]).push(r);(hist[e.aw]=hist[e.aw]||[]).push(-r);
    }
    PRMF.tb=nb>500&&a1<a0-0.005;
    console.log(`逐隊偏差回饋:關 ${nb?(a0/nb).toFixed(3):'-'} / 開 ${nb?(a1/nb).toFixed(3):'-'} → ${PRMF.tb?'啟用':'停用'}`);
  }
  const K=+(+E('MARGIN_K')).toFixed(2),S=+(+E('RUN_SIGMA')).toFixed(2);

  /* ---------- 3.5) 勝分差區間機率表:看好方角度,|預測分差| 每 0.5 分一格,統計近 MB_WIN 季「實際落在 12 種結果」的比例;
       與常態分布(σ=殘差標準差)做滾動回測,全中率較高者採用。分差近年明顯變大(26+ 比例 6%→12%),所以只用近幾季 ---------- */
  const MB_WIN=4,MB_STEP=0.5,MB_MAX=30;
  const Kn=+E('MARGIN_K');
  const predOf=e=>Kn*e.mp*phM(e);
  const bucketOf=a=>{a=Math.abs(a);return a<=5?0:a<=10?1:a<=15?2:a<=20?3:a<=25?4:5;};
  const favIdx=(e,p)=>{const a=e.am*(p>=0?1:-1);return bucketOf(a)+(a>0?0:6);};
  const homeIdx=e=>bucketOf(e.am)+(e.am>0?0:6);
  const toHome=(i,p)=>p>=0?i:(i<6?i+6:i-6);
  const mbRows=reg.filter(e=>e.mp!=null).map(e=>({e,p:predOf(e)}));
  function mbTable(rows){
    const xs=rows.map(r=>[Math.abs(r.p),favIdx(r.e,r.p)]).sort((a,b)=>a[0]-b[0]);const keys=xs.map(x=>x[0]);
    const bl=v=>{let lo=0,hi=keys.length;while(lo<hi){const m=(lo+hi)>>1;if(keys[m]<v)lo=m+1;else hi=m;}return lo;};
    const br=v=>{let lo=0,hi=keys.length;while(lo<hi){const m=(lo+hi)>>1;if(keys[m]<=v)lo=m+1;else hi=m;}return lo;};
    const g=[];
    for(let x=0;x<=MB_MAX+1e-9;x+=MB_STEP){
      let w=1.5,lo=bl(x-w),hi=br(x+w);
      while(hi-lo<300&&w<8){w+=1;lo=bl(x-w);hi=br(x+w);}
      const cnt=new Array(12).fill(0);for(let i=lo;i<hi;i++)cnt[xs[i][1]]++;
      const n=Math.max(1,hi-lo);g.push(cnt.map(c=>+(c/n).toFixed(4)));
    }
    return g;
  }
  const mbPickT=(g,p)=>{const pr=g[Math.min(g.length-1,Math.round(Math.abs(p)/MB_STEP))];let i=0;for(let k=1;k<12;k++)if(pr[k]>pr[i])i=k;return {i:toHome(i,p),pr:pr[i]};};
  const mbPickN=(p,s)=>{const Phi2=z=>0.5*(1+erf2(z/Math.SQRT2));const mu=Math.abs(p);const ed=[[0.5,5.5],[5.5,10.5],[10.5,15.5],[15.5,20.5],[20.5,25.5],[25.5,1e9]];
    let best=-1,bi=0,k=0;for(const sg of [1,-1])for(const [lo,hi] of ed){const a=sg>0?lo:-hi,b=sg>0?hi:-lo;const v=Phi2((b-mu)/s)-Phi2((a-mu)/s);if(v>best){best=v;bi=k;}k++;}
    return toHome(bi,p);};
  function erf2(x){const sg=x<0?-1:1;x=Math.abs(x);const t=1/(1+0.3275911*x);const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return sg*y;}
  const mbBt=[];let mbTotE=0,mbTotN=0,mbTotn=0;
  const mbSeasons=[...new Set(mbRows.map(r=>r.e.sy))].filter(y=>y<seasonNow).sort((a,b)=>a-b).slice(-8);
  for(const S of mbSeasons){
    const tr=mbRows.filter(r=>r.e.sy>=S-MB_WIN&&r.e.sy<S),te=mbRows.filter(r=>r.e.sy===S);
    if(tr.length<2000||te.length<300)continue;
    const g=mbTable(tr);const sig=Math.sqrt(tr.reduce((a,r)=>a+(r.e.am-r.p)**2,0)/tr.length);
    let hE=0,hN=0,cl=0;for(const r of te){const ai=homeIdx(r.e);const t=mbPickT(g,r.p);if(t.i===ai)hE++;cl+=t.pr;if(mbPickN(r.p,sig)===ai)hN++;}
    mbBt.push({s:S,n:te.length,emp:+(hE/te.length*100).toFixed(1),norm:+(hN/te.length*100).toFixed(1),claimed:+(cl/te.length*100).toFixed(1)});
    mbTotE+=hE;mbTotN+=hN;mbTotn+=te.length;
  }
  const mbFinalRows=mbRows.filter(r=>r.e.sy>=seasonNow-MB_WIN);
  const sigmaM=mbFinalRows.length?+Math.sqrt(mbFinalRows.reduce((a,r)=>a+(r.e.am-r.p)**2,0)/mbFinalRows.length).toFixed(2):S;
  const mbUse=(mbTotn>=3000&&mbTotE>mbTotN)?'emp':'norm';
  const MBT={use:mbUse,step:MB_STEP,win:MB_WIN,sigmaM,g:mbFinalRows.length>=2000?mbTable(mbFinalRows):[],
    bt:mbBt,tot:{emp:mbTotn?+(mbTotE/mbTotn*100).toFixed(2):null,norm:mbTotn?+(mbTotN/mbTotn*100).toFixed(2):null},learned:new Date().toISOString().slice(0,10)};
  E(`MB=${JSON.stringify(MBT)}`);
  const mbRate=list=>{const u=list.filter(e=>e.mp!=null);if(!u.length)return null;let h=0;for(const e of u){const p=predOf(e);const t=MBT.g.length?mbPickT(MBT.g,p).i:mbPickN(p,sigmaM);if(t===homeIdx(e))h++;}return +(h/u.length*100).toFixed(1);};
  console.log(`勝分差區間:採用 ${mbUse}(回測 實戰表 ${MBT.tot.emp}% / 常態 ${MBT.tot.norm}%),σ殘差 ${sigmaM}`);

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

  /* ---------- 5.5) 自有資料庫:每日快照(傷兵名單、戰績榜、新聞)、球員資料庫週快照、賽前預測 ---------- */
  const F_DAILY=path.join(D_SEED,`daily-${seasonNow}.json`);
  const DAILY=readJSON(F_DAILY,{inj:{},st:{},news:{}});
  const SBu=E('SB');
  try{const d=await W.jget(`${SBu}/injuries`);
    DAILY.inj[today]=(d.injuries||[]).flatMap(t=>(t.injuries||[]).map(x=>({t:+(t.id||t.team?.id||0),p:W.injAthleteId(x.athlete),n:x.athlete?.displayName||'',
      s:x.status||x.type?.description||'',d:(x.shortComment||x.longComment||x.details?.detail||'').slice(0,160),dt:(x.date||'').slice(0,10)})));
  }catch(e){console.error('傷兵快照失敗:',e.message);}
  try{const d=await W.jget('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?level=2');const o={};
    (d.children||[]).forEach(c=>((c.standings||{}).entries||[]).forEach(en=>{const g=n=>{const s=(en.stats||[]).find(x=>x.name===n);return s?(s.value!=null?+s.value:+s.displayValue):null;};
      if(en.team&&en.team.id)o[en.team.id]=[g('wins'),g('losses'),g('pointDifferential')??g('differential'),g('streak'),(en.stats||[]).find(x=>/lastten|last ten|L10/i.test((x.name||'')+' '+(x.abbreviation||'')))?.displayValue||null];}));
    if(Object.keys(o).length)DAILY.st[today]=o;
  }catch(e){console.error('戰績快照失敗:',e.message);}
  try{const d=await W.jget(`${SBu}/news?limit=30`);
    DAILY.news[today]=(d.articles||[]).filter(a=>a.headline).map(a=>({h:a.headline,d:(a.description||'').slice(0,200),u:a.links?.web?.href||'',t:a.published||''}));
  }catch(e){console.error('新聞快照失敗:',e.message);}
  fs.writeFileSync(F_DAILY,JSON.stringify(DAILY));
  /* 球員資料庫每 7 天存一份快照(每人:隊、出賽、分鐘、得分、籃板、助攻、抄截、火鍋、失誤、FG%、3P%、FT%) */
  try{const F_PH=path.join(D_SEED,`pdbhist-${seasonNow}.json`);const PH=readJSON(F_PH,{});
    const last=Object.keys(PH).sort().pop();
    if(pdbN>=200&&(!last||(Date.parse(today)-Date.parse(last))/864e5>=PDB_SNAP_DAYS)){
      const pdb=E('PDB');const o={};
      Object.values(pdb.players||{}).forEach(p=>{o[p.id]=[p.tid,p.gp,p.min,p.pts,p.reb,p.ast,p.stl,p.blk,p.to,p.fg,p.p3,p.ft];});
      PH[today]=o;fs.writeFileSync(F_PH,JSON.stringify(PH));console.log('球員資料庫快照',today,Object.keys(o).length,'人');}
  }catch(e){console.error('球員資料庫快照失敗:',e.message);}
  /* 賽前預測:今天與明天(美東)尚未開打的比賽,用目前參數 + 官方傷兵名單預測並記錄;開打後不再覆寫 */
  let preN=0;
  try{
    E(`INJ_F=${+inj.f}`);
    for(const d of [today,shiftDate(today,1)]){
      const games=await W.fetchGames(d);
      const live=games.filter(g=>g.status==='Preview'&&g.stype!==1&&g.homeId>=1&&g.homeId<=30&&g.awayId>=1&&g.awayId<=30);
      if(!live.length)continue;
      const season=+E(`seasonOf('${d}')`),asOf=shiftDate(d,-1);
      const ids=[...new Set(live.flatMap(g=>[g.awayId,g.homeId]))];
      const seas=await Promise.all(ids.map(id=>W.fetchTeamSeason(id,season).catch(()=>[])));
      const pm={};await Promise.all(ids.map(async(id,i)=>{pm[id]=await W.statsWithPrior(id,season,asOf,d,seas[i]);}));
      const lg=W.leagueRPG(pm);const EF=W.effTable(d,season);
      W.__inj=await W.loadInjuries(ids);E('INJ=window.__inj;INJ_READY=true');
      setCur(d);
      for(const g of live){
        let hw=0,aw=0;(seas[ids.indexOf(g.homeId)]||[]).forEach(r=>{if(r.done&&r.oppId===g.awayId&&r.pf!=null&&r.date<d){if(r.won)hw++;else aw++;}});
        g._h2h={hw,aw};g._eff=EF;
        const p=W.predict(g,pm,lg,d);if(p.raw_margin_pre==null)continue;
        const ih=W.injInfo(g.homeId),ia=W.injInfo(g.awayId);
        PRE[g.id]={d,aw:g.away,hm:g.home,hid:g.homeId,aid:g.awayId,m:+p.raw_margin_pre.toFixed(2),ih:+ih.adj,ia:+ia.adj,f:+inj.f,
          hn:ih.names,an:ia.names,p:+p.home_prob.toFixed(3),k:+E('MARGIN_K'),s:+E('RUN_SIGMA'),at:new Date().toISOString()};preN++;
      }
      E('INJ_READY=false');
    }
    /* 已入紀錄簿但當時沒附賽前預測的,補附 */
    for(const e of LED){if(!e.pg&&PRE[e.id]&&PRE[e.id].m!=null){const pg=PRE[e.id];e.pg={m:pg.m,ih:pg.ih,ia:pg.ia,f:pg.f,p:pg.p,k:pg.k,s:pg.s,at:pg.at};}}
    fs.writeFileSync(F_PRE,JSON.stringify(PRE));
  }catch(e){console.error('賽前預測失敗:',e.message);}
  console.log(`每日快照:傷兵 ${(DAILY.inj[today]||[]).length} 筆、戰績 ${Object.keys(DAILY.st[today]||{}).length} 隊、新聞 ${(DAILY.news[today]||[]).length} 則;賽前預測記錄 ${preN} 場`);

  /* ---------- 5.6) 由「賽前真實傷兵名單」學傷兵係數:比 box score 推缺陣更準(含出賽存疑),
       以前 60% 樣本學、後 40% 驗證,誤差有降才採用;樣本不足前沿用缺陣殘差法 ---------- */
  let injPG=null;
  {
    const K=+E('MARGIN_K');
    const rows=LED.filter(e=>e.pg&&e.mp!=null&&!e.po&&!e.nu&&!e.nm&&e.pg.f>0&&(e.pg.ih||e.pg.ia))
      .map(e=>{const ph=phM(e);return {x:K*ph*(e.pg.ih-e.pg.ia)/e.pg.f,y:e.am-K*ph*e.mp};});
    if(rows.length>=150){
      const fit=rs=>{let xy=0,xx=0;rs.forEach(r=>{xy+=r.x*r.y;xx+=r.x*r.x;});return xx>0?xy/xx:0;};
      const cut=Math.floor(rows.length*0.6),tr=rows.slice(0,cut),te=rows.slice(cut);
      const fT=Math.max(0.02,Math.min(0.6,fit(tr)));
      const mae=(rs,f)=>rs.reduce((a,r)=>a+Math.abs(r.y-f*r.x),0)/rs.length;
      const m0=mae(te,inj.f),m1=mae(te,fT);
      injPG={n:rows.length,f:+Math.max(0.02,Math.min(0.6,fit(rows))).toFixed(2),fTrain:+fT.toFixed(2),before:+m0.toFixed(3),after:+m1.toFixed(3),adopt:m1<m0-0.005};
      if(injPG.adopt){inj.f=injPG.f;inj.src='pregame';inj.nPG=rows.length;}
      console.log('賽前傷兵係數學習:',JSON.stringify(injPG));
    }else console.log(`賽前傷兵係數學習:樣本 ${rows.length} 場,滿 150 場後啟用`);
  }

  /* ---------- 6) 輸出 ---------- */
  const hist=(prev.hist||[]).filter(h=>h.d!==today);
  if(hit!=null)hist.push({d:today,s:S,k:K,hit:+(hit*100).toFixed(1),mb:mbRate(win),n:samples.length});
  while(hist.length>HIST_MAX)hist.shift();
  const bySy={};LED.forEach(e=>{(bySy[e.sy]=bySy[e.sy]||[]).push(e);});
  const seasons=Object.keys(bySy).map(Number).sort((a,b)=>a-b).map(sy=>{
    const all=bySy[sy],rg=all.filter(e=>!e.po&&!e.nu),rp=rg.filter(e=>!e.nm);
    return {s:sy,n:rg.length,nm:rg.length-rp.length,po:all.filter(e=>e.po).length,nu:all.filter(e=>e.nu).length,
      hit:rp.length?+(rp.filter(e=>e.hit).length/rp.length*100).toFixed(1):null,
      mae:rp.length?+(rp.reduce((a,e)=>a+Math.abs(e.am-e.m*K),0)/rp.length).toFixed(1):null,
      mb:(sy===seasonNow&&rp.some(e=>e.mbh!=null))?+(rp.filter(e=>e.mbh).length/rp.filter(e=>e.mbh!=null).length*100).toFixed(1):mbRate(rp),   /* 本季用凍結的預測,歷史以現行表回算 */
      pl:all.filter(e=>e.pl&&e.pl.h&&e.pl.a).length};});
  const health={withBx:LED.filter(e=>e.bx).length,withPg:LED.filter(e=>e.pg).length,withTs:LED.filter(e=>e.ts).length,withF:LED.filter(e=>e.f).length,games:LED.length,reg:LED.filter(e=>!e.po).length,po:LED.filter(e=>e.po).length,withPl:LED.filter(e=>e.pl).length,
    fixed,added,errors,fitN:samples.length,pdb:pdbN,seasonsN:seasons.length,seasons,secs:Math.round((Date.now()-t0)/1000)};
  const fit={variant,prm:PRMF,K:KF,coef:coefF,trainN:finalTrain.length,win:WIN,bt,tot,hcaBySeason,phEval};
  const calib={k:K,sigma:S,injF:inj.f,inj,injPG,prm:PRMF,mb:MBT,fit,hist,ledger:LED.slice(-CLIENT_LEDGER).map(slim),
    last:LED.length?LED[LED.length-1].d:null,updated:new Date().toISOString(),window:FIT_DAYS,health};
  fs.writeFileSync(F_CALIB,JSON.stringify(calib));
  for(const sy of Object.keys(bySy)){
    const f=path.join(D_SEED,`ledger-${sy}.json`);const txt=JSON.stringify(bySy[sy]);
    if(!fs.existsSync(f)||fs.readFileSync(f,'utf8')!==txt)fs.writeFileSync(f,txt);
  }
  fs.writeFileSync(F_META,JSON.stringify(meta));
  if(fs.existsSync(F_SEED_OLD))fs.unlinkSync(F_SEED_OLD);
  console.log('完成:',JSON.stringify({k:K,sigma:S,injF:inj.f,hit:hit!=null?+(hit*100).toFixed(1):null,...health,seasons:undefined}));
  seasons.forEach(x=>console.log(`  ${x.s-1}-${String(x.s).slice(2)}  例行賽 ${x.n}  季後賽 ${x.po}  中立場 ${x.nu}  命中 ${x.hit}%  分差誤差 ${x.mae}  球員數據 ${x.pl}`));
  dom.window.close();
  process.exit(0);
})().catch(e=>{console.error('校準失敗:',e);process.exit(1);});
