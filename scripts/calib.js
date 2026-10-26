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
const Margin=require('./margin-model.js');
const {JSDOM,VirtualConsole}=require('jsdom');
/* 版本:v3.0(傷兵改以最終分數加在 K 與季內乘數之後,上限 −7)v2.7(ESPN BPI 回補與三來源混合、官方裁判派遣、官方傷兵報告 PDF、球員異動、球隊進階統計快照)v2.6(逐球紀錄改 gzip、回補 10 季;賽前傷兵只信賽後 3 天內擷取)v2.3(市場盤口對照與裁判因子,皆滾動驗證後才啟用)v2.2(完整比賽過程:逐球紀錄、勝率曲線、裁判、盤口、該場賽前傷兵)v2.1(勝分差區間機率表與全中回測)v2.0(自有資料庫:完整 box score/各節比分/每日傷兵、戰績、新聞快照/球員資料庫週快照/賽前含傷兵預測,並由賽前傷兵學係數)v1.9(掃描前先套學習參數、輸出各季開幕日 ssMap)v1.8(季內時間刻度、傷兵係數不再拉回 0.35)v1.7.2(K/σ 改用兩季窗口、逐隊偏差需驗證才啟用)v1.7.1(休息天數美東日期修正)v1.7(參數學習 + 攻守效率 + 公平回測)v1.6.3(同場重複登錄去重、賽季依日期推算、收錄無預測場次) 1994-95 季起全部賽季(不用 localStorage) + 失敗日期重試 + 排除表演賽與空殼場次 */

const ROOT=path.resolve(__dirname,'..');
const F_CALIB=path.join(ROOT,'calib.json');
const F_MARGIN=path.join(ROOT,'margin-model.json');
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
const BX_PER_RUN=+(process.env.BX_PER_RUN||4000);   // 每次執行回補完整原始資料的歷史場次上限(約 3~5 分鐘)
const zlib=require('zlib');
const PDB_SNAP_DAYS=7;    // 球員資料庫快照間隔(天)
const PBP_BACK_SEASONS=+(process.env.PBP_BACK_SEASONS||10);   // 逐球紀錄回補到幾季前(預設 10 季;以 gzip 存,每季約 8MB)
const GI_MAX_AGE=3;   // 該場賽前傷兵只在比賽後 3 天內擷取才可信(ESPN 舊比賽的 summary 傷兵欄是「現在」的名單)

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
const slim=e=>{const o={id:e.id,d:e.d,sy:e.sy,aw:e.aw,hm:e.hm,hid:e.hid,aid:e.aid,m:e.m,am:e.am,hit:e.hit};if(e.mb!=null){o.mb=e.mb;o.mbh=e.mbh;if(e.mbp!=null)o.mbp=e.mbp;}if(e.pg)o.pg=e.pg;if(e.tip)o.tip=e.tip;if(e.mm!=null)o.mm=e.mm;if(e.mk!=null)o.mk=e.mk;if(e.mp!=null)o.mp=e.mp;if(e.ts)o.ts=e.ts;if(e.st!=null)o.st=e.st;if(e.po)o.po=1;if(e.nu)o.nu=1;if(e.nm)o.nm=1;return o;};
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
      if(e.gi&&!e.giT){delete e.gi;}   /* 舊版在賽後很久才擷取的「賽前傷兵」其實是現在的名單,不可信,移除 */
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
      w.__CLOUD_BUILD=true;w.NBAMargin=Margin;
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
  if(prev.mb&&Array.isArray(prev.mb.g))E(`MB=${JSON.stringify(prev.mb)}`);
  const prevMargin=readJSON(F_MARGIN,null);if(prevMargin)E(`MARGIN_MODEL=${JSON.stringify(prevMargin)}`);
  {const mkp={};for(const [id,x] of Object.entries(PRE)){const of=(x.ofo&&x.ofo.length)?x.ofo:(x.of||null);if(x.mk!=null||x.bpi!=null||(of&&of.length))mkp[id]={mk:x.mk??null,of,bpi:x.bpi??null};}
    E(`MK_PRE=${JSON.stringify(mkp)}`);}   /* 賽前記錄的盤口與裁判,掃描入帳時沿用(不用賽後資料) */   /* 勝分差區間機率表(昨日學得),新場次的區間預測據此凍結 */
  /* 紀錄簿不放 localStorage(上限 500 萬字元,數萬場會爆):
     預測某日時,把「該日之前最近 3,000 場」直接交給網頁的 ledger(),逐隊偏差只需每隊最近 12 場,且不偷看未來 */
  let CUR=[];
  W.ledger=()=>CUR;
  const before=d=>{let lo=0,hi=LED.length;while(lo<hi){const mid=(lo+hi)>>1;if(LED[mid].d<d)lo=mid+1;else hi=mid;}return lo;};
  const setCur=d=>{const i=before(d);CUR=LED.slice(Math.max(0,i-3000),i);};

  /* ---------- 0) 球員數據 + 球隊數據(box score);掃描前先補,攻守效率才有資料可用 ---------- */
  /* 每場 box score 寫入紀錄簿:精簡版(pl/ts,模型學習用)+ 完整原始版(bx 全員全欄位、tst 球隊全部統計、ls 各節比分、hs/as 終場比分、場館/觀眾/開球時間)
     ——完整版是我們自己的資料庫,不依賴 ESPN 日後還留不留 */
  /* 逐球紀錄按日期存檔 seed/pbp-SY/YYYY-MM-DD.json(當天所有場次),上季起;更早賽季只存 box score 與裁判/盤口/賽前傷兵 */
  const PBP_DAYS={};const pbpFile=(sy,d)=>path.join(D_SEED,`pbp-${sy}`,`${d}.json.gz`);
  const readGz=f=>{try{return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));}catch(e){return null;}};
  const pbpLoad=f=>readGz(f)||readJSON(f.replace(/\.gz$/,''),{});   /* 相容舊的未壓縮檔 */
  const pbpStore=(e,pbp)=>{const f=pbpFile(e.sy,e.d);if(!PBP_DAYS[f]){PBP_DAYS[f]=pbpLoad(f);}PBP_DAYS[f][e.id]=pbp;e.pb=1;};
  const applyBox=(e,r0)=>{const r=JSON.parse(JSON.stringify(r0));
    if(!e.pl)e.pl=r.pl;if(r.hid>=1&&r.hid<=30&&r.aid>=1&&r.aid<=30){e.hid=r.hid;e.aid=r.aid;}
    if(r.ts)e.ts=r.ts;else e.tsx=1;
    if(r.bx)e.bx=r.bx;else e.bxx=1;
    for(const k of ['tst','ls','hs','as','ven','att','tip','of','od','ss'])if(r[k]!=null)e[k]=r[k];
    if(r.gi&&(Date.parse(today)-Date.parse(e.d))/864e5<=GI_MAX_AGE){e.gi=r.gi;e.giT=today;}
    if(e.sy>=seasonNow0-PBP_BACK_SEASONS){if(r.pbp&&r.pbp.plays&&r.pbp.plays.length)pbpStore(e,r.pbp);else e.pbx=1;}
    e.px=2;};   /* px = 完整過程擷取版本 */
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
  {const need=e=>!e.bxx&&(!(e.px>=2)||(e.sy>=seasonNow0-PBP_BACK_SEASONS&&!e.pb&&!e.pbx));
    const bk=LED.filter(need).sort((a,b)=>b.d.localeCompare(a.d)).slice(0,BX_PER_RUN);
    if(bk.length)await fetchBox(`完整原始資料回補(剩 ${LED.filter(need).length} 場)`,bk);}

  /* ESPN BPI 賽前預測(predictor):主隊勝率與預期分差,近 10 季可回補;記下 lastModified 以便只採用開打前的版本 */
  const CORE2='https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
  const fetchBPI=async id=>{try{const p=await W.jget(`${CORE2}/events/${id}/competitions/${id}/predictor`);
      const side=p.homeTeam&&p.homeTeam.statistics?['h',p.homeTeam]:(p.awayTeam&&p.awayTeam.statistics?['a',p.awayTeam]:null);if(!side)return {x:1};
      const g=n=>{const x=(side[1].statistics||[]).find(z=>z.name===n);return x?+x.value:null;};
      const wp=g('gameProjection'),pd=g('teamPredPtDiff');if(wp==null)return {x:1};
      return {hp:+((side[0]==='h'?wp:100-wp)/100).toFixed(3),pd:pd==null?null:+((side[0]==='h'?pd:-pd)).toFixed(2),lm:p.lastModified||null};
    }catch(e){return null;}};
  {const need=e=>e.sy>=seasonNow0-PBP_BACK_SEASONS&&!e.bpi&&!e.bpx&&!e.po&&!(PRE[e.id]&&PRE[e.id].bpi!=null);
    const bk=LED.filter(need).sort((a,b)=>b.d.localeCompare(a.d)).slice(0,BX_PER_RUN);let n=0;
    for(let i=0;i<bk.length;i+=PL_BATCH){await Promise.all(bk.slice(i,i+PL_BATCH).map(async e=>{const r=await fetchBPI(e.id);if(!r)return;if(r.x)e.bpx=1;else{e.bpi=r;n++;}}));}
    if(bk.length)console.log(`ESPN BPI 回補:${n}/${bk.length} 場(剩 ${LED.filter(need).length-bk.length} 場)`);}

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
          /* 最終預測(含盤口混合、含傷兵)與勝分差區間:優先用「開打前真的記下」的賽前預測;沒有(例如當天才新增的比賽)才用現在重算的 */
          const pg0=PRE[String(x.id)];const useP=pg0&&pg0.mm!=null&&!x.nm;
          const mm=useP?+pg0.mm:(x.mm!=null?+x.mm:null),mbI=useP?pg0.mb:x.mb,mbP=useP?pg0.mbp:x.mbp,mk=useP?pg0.mk:x.mk;
          if(mbI!=null){e.mb=mbI;e.mbp=mbP;e.mbh=(W.mbActualIdx(x.actM)===mbI)?1:0;}   /* 勝分差區間預測與是否全中,凍結 */
          if(mk!=null)e.mk=mk;if(mm!=null){e.mm=mm;e.hf=((mm>=0)===x.homeWon)?1:0;}   /* 當時盤口線、最終分差(分)、最終預測是否命中,凍結 */
          if(useP)e.pgu=1;
          if(pg0&&pg0.bpi!=null)e.bpi={hp:pg0.bpiP??null,pd:+pg0.bpi,lm:pg0.at,pre:1};   /* 開打前記到的 BPI,優先於賽後回補的版本 */
          if(x.nm)e.nm=1;
          if(x.f)e.f=JSON.parse(JSON.stringify(x.f));
          if(e.d>=BUBBLE[0]&&e.d<BUBBLE[1])e.nu=1;
          if(x.hs!=null){e.hs=x.hs;e.as=x.as;}
          const pg=PRE[e.id];if(pg&&pg.m!=null)e.pg={m:pg.m,mm:pg.mm??null,mb:pg.mb??null,mk:pg.mk??null,ih:pg.ih,ia:pg.ia,f:pg.f,p:pg.p,k:pg.k,s:pg.s,at:pg.at,u:pg.u||1,mbp:pg.mbp,q:pg.q,interval:pg.interval,shadow:pg.shadow,mv:pg.mv,tip:pg.tip};   /* 賽前(含當日傷兵)預測,凍結 */
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

  /* Independent OOF margin calibration; never overwrite frozen historical forecasts. */
  try{const artifact=Margin.build(LED,{cutoff:today,season:seasonNow});if(artifact){
    fs.writeFileSync(F_MARGIN,JSON.stringify(artifact));E(`MARGIN_MODEL=${JSON.stringify(artifact)}`);
    console.log('勝分差時間外校準',JSON.stringify(artifact.validation));
  }}catch(e){console.error('勝分差校準保留上一版:',e.message);}

  /* ---------- 3.6) 多來源混合:模型 × 市場收盤線 × ESPN BPI。各組合(模型+市場、模型+BPI、三者)分別以時間順序滾動驗證
       (先 400 場起、每 150 場一段),測試段誤差比純模型低才啟用;權重取誤差最低者,相差 0.03 分內取模型權重最大者。
       BPI 只採用 lastModified 早於開球時間的版本(避免賽後更新的偷看) ---------- */
  {
    const bpiOK=e=>e.bpi&&e.bpi.pd!=null&&(e.bpi.pre||!e.bpi.lm||!e.tip||Date.parse(e.bpi.lm)<=Date.parse(e.tip)+600000);
    const mkOf=e=>(e.od&&(e.od.spH?.[1]!=null||e.od.sp!=null))?-(e.od.spH?.[1]??e.od.sp):null;
    const base=reg.filter(e=>e.mp!=null).sort((a,b)=>a.d.localeCompare(b.d));
    const mae=(rs,f)=>rs.reduce((a,r)=>a+Math.abs(r.y-f(r)),0)/Math.max(1,rs.length);
    const sd=(rs,f)=>Math.sqrt(rs.reduce((a,r)=>a+(r.y-f(r))**2,0)/Math.max(1,rs.length));
    /* 權重格點:ws = [模型, 其他來源...],總和 1,步長 0.05 */
    const grid=k=>{const out=[];const rec=(pre,left,depth)=>{if(depth===k-1){out.push([...pre,+left.toFixed(2)]);return;}for(let w=0;w<=left+1e-9;w+=0.05)rec([...pre,+w.toFixed(2)],left-w,depth+1);};rec([],1,0);return out;};
    const learn=(rs,k)=>{const G=grid(k);const ms=G.map(ws=>[ws,mae(rs,r=>ws.reduce((a,w,i)=>a+w*r.x[i],0))]);const bm=Math.min(...ms.map(x=>x[1]));
      return ms.filter(x=>x[1]<=bm+0.03).reduce((a,x)=>x[0][0]>a[0]?x[0]:a,[-1])};
    const evalRows=(rows,k)=>{let tM=0,tB=0,tn=0;const by={};
      for(let i=400;i<rows.length;i+=150){const tr=rows.slice(0,i),te=rows.slice(i,i+150);if(te.length<50)break;
        const ws=learn(tr,k);tM+=mae(te,r=>r.x[0])*te.length;tB+=mae(te,r=>ws.reduce((a,w,j)=>a+w*r.x[j],0))*te.length;tn+=te.length;
        for(let j=1;j<k;j++)by[j]=(by[j]||0)+mae(te,r=>r.x[j])*te.length;}
      if(!tn)return null;const ev={model:+(tM/tn).toFixed(3),blend:+(tB/tn).toFixed(3),nTest:tn};for(let j=1;j<k;j++)ev['src'+j]=+(by[j]/tn).toFixed(3);return ev;};
    /* 使用者決定:預測只用自己的模型,市場盤口與 BPI 只記錄、只對照,不混進預測(EXT_BLEND=1 才會啟用混合) */
    const EXT_BLEND=process.env.EXT_BLEND==='1';
    const fit=(rows,k,label)=>{const ev=evalRows(rows,k);const use=EXT_BLEND&&!!(ev&&ev.nTest>=400&&ev.blend<ev.model-0.05);
      const ws=use?learn(rows,k):[1,...new Array(k-1).fill(0)];
      const sigRatio=use&&rows.length>=300?+Math.max(0.7,Math.min(1,sd(rows,r=>ws.reduce((a,w,j)=>a+w*r.x[j],0))/sd(rows,r=>r.x[0]))).toFixed(3):1;
      const o={use,ws,n:rows.length,eval:ev,sigRatio};console.log(label,JSON.stringify(o));return o;};
    const rowsMK=base.filter(e=>mkOf(e)!=null).map(e=>({x:[predOf(e),mkOf(e)],y:e.am}));
    const rowsBP=base.filter(e=>bpiOK(e)).map(e=>({x:[predOf(e),e.bpi.pd],y:e.am}));
    const rows3=base.filter(e=>mkOf(e)!=null&&bpiOK(e)).map(e=>({x:[predOf(e),mkOf(e),e.bpi.pd],y:e.am}));
    const MK=fit(rowsMK,2,'模型+市場:'),MKB=fit(rowsBP,2,'模型+BPI:'),MK3=fit(rows3,3,'模型+市場+BPI:');
    PRMF.mk={use:MK.use,w:MK.ws[0],n:MK.n,eval:MK.eval,sigRatio:MK.sigRatio};
    PRMF.mkb={use:MKB.use,w:MKB.ws[0],n:MKB.n,eval:MKB.eval,sigRatio:MKB.sigRatio};
    PRMF.mk3={use:MK3.use,w:MK3.ws[0],wm:MK3.ws[1],wb:MK3.ws[2],n:MK3.n,eval:MK3.eval,sigRatio:MK3.sigRatio};
    PRMF.bpiN=LED.filter(e=>e.bpi).length;
  }
  /* ---------- 3.7) 裁判因子:每位裁判過往「主隊實際 − 模型預期」收縮平均(÷(n+30)),逐季滾動驗證(只用該季之前的資料),
       有降低誤差才啟用。裁判一季只吹 40–65 場,預期多半是雜訊,所以門檻放嚴 ---------- */
  {
    const rows=reg.filter(e=>e.mp!=null&&Array.isArray(e.of)&&e.of.length).map(e=>({sy:e.sy,d:e.d,of:e.of,p:predOf(e),y:e.am}));
    const build=rs=>{const t={};for(const r of rs){const res=r.y-r.p;for(const n of r.of){const x=t[n]=t[n]||[0,0];x[0]+=res;x[1]++;}}
      const o={};for(const [n,x] of Object.entries(t))o[n]=+(x[0]/(x[1]+30)).toFixed(2);return o;};
    const adj=(tab,of)=>{const v=of.map(n=>tab[n]).filter(x=>isFinite(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;};
    const sys=[...new Set(rows.map(r=>r.sy))].sort((a,b)=>a-b);
    let t0=0,t1=0,tn=0;
    for(const S of sys.slice(1)){const tr=rows.filter(r=>r.sy<S),te=rows.filter(r=>r.sy===S);if(tr.length<500||te.length<200)continue;
      const tab=build(tr);for(const r of te){t0+=Math.abs(r.y-r.p);t1+=Math.abs(r.y-(r.p+adj(tab,r.of)));tn++;}}
    const ev=tn?{model:+(t0/tn).toFixed(3),withRef:+(t1/tn).toFixed(3),nTest:tn}:null;
    const use=!!(ev&&tn>=800&&ev.withRef<ev.model-0.02);
    PRMF.ref={use,n:rows.length,refs:Object.keys(build(rows)).length,eval:ev};if(use)PRMF.ref.tab=build(rows);
    console.log('裁判因子:',JSON.stringify({...PRMF.ref,tab:undefined}));
  }
  E(`Object.assign(PRM,${JSON.stringify({mk:PRMF.mk,mkb:PRMF.mkb,mk3:PRMF.mk3,ref:PRMF.ref})})`);

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
  const DAILY=readJSON(F_DAILY,{inj:{},st:{},news:{}});DAILY.log=DAILY.log||{};DAILY.log[today]=[];const dlog=m=>{DAILY.log[today].push(m);console.log(m);};
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
  /* NBA 官方裁判派遣(每個比賽日約美東 9 點公布):比賽(城市 @ 城市)→ 主審/裁判/副裁/替補 */
  let REFTODAY=[];
  try{const h=await (await fetch('https://official.nba.com/referee-assignments/',{headers:{'User-Agent':'Mozilla/5.0 (nba-scoreboard)'},signal:AbortSignal.timeout(20000)})).text();
    const sec=h.split(/WNBA Referee Assignments/)[0];const dm=/NBA Referee Assignments<\/h\d>\s*<[^>]*>([^<]+)/.exec(sec)||/([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(sec);
    const tbl=/<tbody>([\s\S]*?)<\/tbody>/i.exec(sec);
    if(tbl){for(const tr of tbl[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)){const cells=[...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c=>c[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
        if(cells.length>=4&&/@/.test(cells[0]))REFTODAY.push({g:cells[0],crew:cells.slice(1,4).map(x=>x.replace(/\s*\(#\d+\)/,'').trim()).filter(Boolean),alt:(cells[4]||'').replace(/\s*\(#\d+\)/,'').trim()||null});}}
    DAILY.refs=DAILY.refs||{};DAILY.refs[today]={posted:dm?dm[1].trim():null,games:REFTODAY};
    console.log(`官方裁判派遣:${REFTODAY.length} 場`);
  }catch(e){dlog('裁判派遣失敗:'+e.message);}
  /* NBA 官方傷兵報告 PDF(每天多版):取最新一份,存原文與解析後的列(球隊/球員/狀態/原因) */
  let INJOFF=[];
  const TEAMGLUED=[...new Set(LED.filter(e=>e.sy>=seasonNow-1).flatMap(e=>[e.hm,e.aw]))].map(n=>String(n).replace(/\s+/g,'')).sort((a,b)=>b.length-a.length);
  try{const idx=await (await fetch(`https://official.nba.com/nba-injury-report-${seasonNow-1}-${String(seasonNow).slice(2)}-season/`,{headers:{'User-Agent':'Mozilla/5.0 (nba-scoreboard)'},signal:AbortSignal.timeout(20000)})).text();
    /* 連結格式 Injury-Report_YYYY-MM-DD_HH_MM(AM|PM).pdf,每 15 分鐘一版;頁面會列出整天的時段,實際存在的才抓得到,由最新往前試 */
    const links=[...new Set([...idx.matchAll(/href="([^"]*Injury-Report_(\d{4}-\d\d-\d\d)_(\d\d)_(\d\d)([AP]M)\.pdf)"/gi)].map(m=>JSON.stringify({u:m[1],d:m[2],h:(+m[3]%12)+(m[5].toUpperCase()==='PM'?12:0),mi:+m[4]})))].map(x=>JSON.parse(x))
      .sort((a,b)=>(b.d+String(b.h).padStart(2,'0')+String(b.mi).padStart(2,'0')).localeCompare(a.d+String(a.h).padStart(2,'0')+String(a.mi).padStart(2,'0')));
    DAILY.injpdf=DAILY.injpdf||{};dlog(`官方傷兵報告索引:Injury-Report 連結 ${links.length} 個${links[0]?'(最新 '+links[0].u.split('/').pop()+')':''}`);
    let L0=null,buf=null;
    for(const L of links.slice(0,12)){try{const r=await fetch(L.u,{signal:AbortSignal.timeout(30000)});if(r.ok){const b=Buffer.from(await r.arrayBuffer());if(b.length>2000&&b.slice(0,4).toString()==='%PDF'){L0=L;buf=b;break;}}}catch(e){}}
    if(L0){const key=`${L0.d}_${String(L0.h).padStart(2,'0')}${String(L0.mi).padStart(2,'0')}`;
      if(!Object.values(DAILY.injpdf).some(x=>x.key===key&&x.pv===2)){
        let text='';try{const pdfParse=require('pdf-parse');text=(await pdfParse(buf)).text||'';}catch(e){console.error('pdf-parse 不可用:',e.message);}
        /* pdf-parse 會把空白吃掉:每列形如 [日期][時間(ET)][AAA@BBB][球隊名]姓,名[,Jr.]狀態[原因],原因可能延到下一行 */
        const rows=[];let gd='',gt='',game='',team='';
        for(const raw of text.split(/\n/)){const ln=raw.replace(/\s+/g,'').trim();if(!ln||/^InjuryReport:|^Page\d|^GameDate/.test(ln))continue;
          const m=/^(?:(\d\d\/\d\d\/\d{4}))?(?:(\d\d:\d\d)\(ET\))?(?:([A-Z]{3}@[A-Z]{3}))?(.*?)(Out|Doubtful|Questionable|Probable|Available)(.*)$/.exec(ln);
          if(m){if(m[1])gd=m[1];if(m[2])gt=m[2];if(m[3])game=m[3];
            let mid=m[4]||'';const tn=TEAMGLUED.find(t=>mid.startsWith(t));if(tn){team=tn;mid=mid.slice(tn.length);}   /* 球隊名(去空白)黏在姓氏前,先用已知 30 隊名剝掉 */
            const pm=/([A-Z][A-Za-z.'\-]*(?:,[A-Z][A-Za-z.'\-]*)+)$/.exec(mid);const pl=pm?pm[1]:mid;
            const parts=pl.split(',');const first=parts[parts.length-1],last=parts[0],suf=parts.length>2?parts.slice(1,-1).join(' '):'';
            rows.push({d:gd,tm:gt,g:game,team,p:`${first} ${last}${suf?' '+suf:''}`.trim(),s:m[5],r:m[6]||''});}
          else if(rows.length)rows[rows.length-1].r+=ln;}
        rows.forEach(x=>{x.r=x.r.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/-/g,' - ').replace(/\s+/g,' ').slice(0,80);});
        INJOFF=rows;
        DAILY.injpdf[today]={key,pv:2,url:L0.u,n:rows.length,rows,raw:text.slice(0,60000)};
        dlog(`官方傷兵報告:${key},解析 ${rows.length} 列,原文 ${text.length} 字`);}else dlog('官方傷兵報告:最新版已存過 '+key);}else dlog('官方傷兵報告:沒有抓到可用的 PDF');
  }catch(e){dlog('官方傷兵報告失敗:'+e.message);}
  if(!INJOFF.length){const lastK=Object.keys(DAILY.injpdf||{}).sort().pop();if(lastK)INJOFF=DAILY.injpdf[lastK].rows||[];}   /* 本次沒有新版就用最近存的一份 */
  /* 球員異動(簽約、交易、釋出) */
  try{const d=await W.jget(`${SBu}/transactions?limit=100`);DAILY.tx=DAILY.tx||{};
    const seen=new Set(Object.values(DAILY.tx).flat().map(x=>x.d+'|'+x.t+'|'+x.s));const add=[];
    for(const x of (d.transactions||[])){const o={d:(x.date||'').slice(0,10),t:+(x.team?.id||0),ab:x.team?.abbreviation||'',s:(x.description||'').slice(0,200)};if(!seen.has(o.d+'|'+o.t+'|'+o.s)){seen.add(o.d+'|'+o.t+'|'+o.s);add.push(o);}}
    if(add.length)DAILY.tx[today]=add;console.log(`球員異動:新增 ${add.length} 筆`);
  }catch(e){console.error('球員異動失敗:',e.message);}
  fs.writeFileSync(F_DAILY,JSON.stringify(DAILY));
  /* ESPN 球隊進階季統計(真實命中率、節奏、助攻率、失誤率、籃板率等 ~150 項)每 7 天快照 */
  try{const F_TS=path.join(D_SEED,`teamstats-${seasonNow}.json`);const TSH=readJSON(F_TS,{});const last=Object.keys(TSH).sort().pop();
    if(!last||(Date.parse(today)-Date.parse(last))/864e5>=PDB_SNAP_DAYS){const o={};
      for(let tid=1;tid<=30;tid++){try{const st=await W.jget(`${CORE2}/seasons/${seasonNow}/types/2/teams/${tid}/statistics`);const m={};
        ((st.splits||{}).categories||[]).forEach(c=>(c.stats||[]).forEach(x=>{if(x.name&&isFinite(+x.value))m[x.name]=+(+x.value).toFixed(3);}));if(Object.keys(m).length)o[tid]=m;}catch(e){}}
      if(Object.keys(o).length>=20){TSH[today]=o;fs.writeFileSync(F_TS,JSON.stringify(TSH));console.log('球隊進階統計快照',today,Object.keys(o).length,'隊');}}
  }catch(e){console.error('球隊進階統計失敗:',e.message);}
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
      const live=games.filter(g=>g.status==='Preview'&&(!g.startISO||Date.parse(g.startISO)>Date.now())&&g.stype!==1&&g.homeId>=1&&g.homeId<=30&&g.awayId>=1&&g.awayId<=30);
      if(!live.length)continue;
      const season=+E(`seasonOf('${d}')`),asOf=shiftDate(d,-1);
      const ids=[...new Set(live.flatMap(g=>[g.awayId,g.homeId]))];
      const seas=await Promise.all(ids.map(id=>W.fetchTeamSeason(id,season).catch(()=>[])));
      const pm={};await Promise.all(ids.map(async(id,i)=>{pm[id]=await W.statsWithPrior(id,season,asOf,d,seas[i]);}));
      const lg=W.leagueRPG(pm);const EF=W.effTable(d,season);
      W.__inj=await W.loadInjuries(ids);E('INJ=window.__inj;INJ_READY=true');
      {const md=`${d.slice(5,7)}/${d.slice(8,10)}/${d.slice(0,4)}`;const rowsD=INJOFF.filter(r=>r.d===md);
        if(rowsD.length){W.__injOff=rowsD;const nOff=E('applyOfficialInjuries(window.__injOff)');dlog(`官方傷兵報告套用 ${d}:${nOff}/${rowsD.length} 筆(含 Doubtful/Questionable/Probable 分級)`);}}
      setCur(d);
      for(const g of live){
        let hw=0,aw=0;(seas[ids.indexOf(g.homeId)]||[]).forEach(r=>{if(r.done&&r.oppId===g.awayId&&r.pf!=null&&r.date<d){if(r.won)hw++;else aw++;}});
        g._h2h={hw,aw};g._eff=EF;
        const info=await W.fetchGameInfo(g.id);if(info.mk!=null){g._mk=info.mk;g._mkPv=info.mkPv;}if(info.of&&info.of.length)g._of=info.of;
        const bp=await fetchBPI(g.id);if(bp&&!bp.x&&bp.pd!=null)g._bpi=bp.pd;
        /* 官方裁判派遣:以城市名對應(Cleveland @ Philadelphia ↔ Cleveland Cavaliers @ Philadelphia 76ers;LA Lakers/LA Clippers 另處理) */
        const norm=x=>String(x).toLowerCase().replace(/^l\.?a\.? /,'los angeles ').replace(/[^a-z ]/g,'').trim();
        let ofo=null;if(d===today&&REFTODAY.length){const row=REFTODAY.find(r=>{const [a,h]=r.g.split('@').map(norm);return a&&h&&norm(g.away).startsWith(a)&&norm(g.home).startsWith(h);});if(row)ofo=row.crew;}
        if(ofo&&ofo.length)g._of=ofo;
        const p=W.predict(g,pm,lg,d);if(p.raw_margin_pre==null)continue;
        const ih=W.injInfo(g.homeId),ia=W.injInfo(g.awayId);
        PRE[g.id]={d,aw:g.away,hm:g.home,hid:g.homeId,aid:g.awayId,m:+p.raw_margin_pre.toFixed(2),mm:+p.raw_margin.toFixed(2),ih:+ih.adj,ia:+ia.adj,f:+inj.f,
          hn:ih.names,an:ia.names,p:p.home_prob,mb:p.mb,mbp:p.mbp,q:p.mbProbs,interval:p.marginInterval??null,shadow:p.shadow??null,mv:p.distributionVersion??null,tip:g.startISO,mk:info.mk??null,ou:info.ou??null,of:info.of||[],ofo:ofo||null,
          bpi:(bp&&!bp.x)?bp.pd:null,bpiP:(bp&&!bp.x)?bp.hp:null,
          k:+E('MARGIN_K'),s:+E('RUN_SIGMA'),at:new Date().toISOString(),u:2};preN++;
      }
      E('INJ_READY=false');
    }
    /* 已入紀錄簿但當時沒附賽前預測的,補附 */
    for(const e of LED){if(!e.pg&&PRE[e.id]&&PRE[e.id].m!=null){const pg=PRE[e.id];e.pg={m:pg.m,mm:pg.mm??null,mb:pg.mb??null,mk:pg.mk??null,ih:pg.ih,ia:pg.ia,f:pg.f,p:pg.p,k:pg.k,s:pg.s,at:pg.at,u:pg.u||1,mbp:pg.mbp,q:pg.q,interval:pg.interval,shadow:pg.shadow,mv:pg.mv,tip:pg.tip};}}
    fs.writeFileSync(F_PRE,JSON.stringify(PRE));
  }catch(e){console.error('賽前預測失敗:',e.message);}
  fs.writeFileSync(F_DAILY,JSON.stringify(DAILY));   /* 賽前段落的執行記錄也要存 */
  console.log(`每日快照:傷兵 ${(DAILY.inj[today]||[]).length} 筆、戰績 ${Object.keys(DAILY.st[today]||{}).length} 隊、新聞 ${(DAILY.news[today]||[]).length} 則;賽前預測記錄 ${preN} 場`);

  /* ---------- 5.55) 教練(各季各隊總教練,ESPN core API;本季每天更新,歷史賽季一次補齊)、對戰索引、球隊風格 ---------- */
  const F_COACH=path.join(D_SEED,'coaches.json');const COACH=readJSON(F_COACH,{});
  try{
    const teamIds=[...new Set(LED.filter(e=>e.sy>=seasonNow-1).flatMap(e=>[e.hid,e.aid]))].filter(x=>x>=1&&x<=30);
    const need=[];for(let sy=FIRST_SEASON;sy<=seasonNow;sy++){if(sy===seasonNow||!COACH[sy]||Object.keys(COACH[sy]).length<25)need.push(sy);}
    let calls=0;
    for(const sy of need.slice(-3).concat(need.length>3?need.slice(0,-3).slice(0,2):[])){   /* 每次最多處理 5 季,幾天內補完 */
      const o=COACH[sy]||{};
      for(const tid of (teamIds.length?teamIds:Array.from({length:30},(_,i)=>i+1))){
        try{const a=await W.jget(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${sy}/teams/${tid}/coaches`);calls++;
          const ref=((a.items||[])[0]||{}).$ref;if(!ref)continue;
          const c=await W.jget(ref.replace('http://','https://'));calls++;
          o[tid]={id:+c.id,n:`${c.firstName||''} ${c.lastName||''}`.trim(),exp:c.experience??null};
        }catch(e){}
      }
      if(Object.keys(o).length)COACH[sy]=o;
    }
    fs.writeFileSync(F_COACH,JSON.stringify(COACH));
    console.log(`教練:${Object.keys(COACH).length} 季已有資料(本次 ${calls} 次查詢)`);
  }catch(e){console.error('教練資料失敗:',e.message);}
  /* 對戰索引:兩隊歷年每一場(日期、主客、比分),供網頁點「對戰紀錄」即時查 */
  try{const H2={};
    for(const e of LED){if(e.hs==null)continue;const k=Math.min(e.hid,e.aid)+'-'+Math.max(e.hid,e.aid);(H2[k]=H2[k]||[]).push([e.d,e.hid,e.hs,e.as,e.po?1:0,e.id]);}
    fs.writeFileSync(path.join(D_SEED,'h2h.json'),JSON.stringify(H2));
  }catch(e){console.error('對戰索引失敗:',e.message);}
  /* 球隊風格(本季與上季):節奏、三分出手率、罰球率、進攻籃板率、失誤率、助攻率、禁區得分、快攻得分、最大領先、領先易手 */
  const STY={};
  try{
    const pair=v=>{const m=/(\d+)-(\d+)/.exec(String(v||''));return m?[+m[1],+m[2]]:null;};
    for(const sy of [seasonNow-1,seasonNow]){const T={};
      for(const e of LED){if(e.sy!==sy||e.po||!e.tst||!e.ts||e.hs==null)continue;
        for(const [sd,tid,pf,pa,ts] of [['h',e.hid,e.hs,e.as,e.ts.h],['a',e.aid,e.as,e.hs,e.ts.a]]){
          const st=e.tst[sd];if(!st)continue;const x=T[tid]=T[tid]||{g:0,pf:0,pa:0,fga:0,p3a:0,fta:0,orb:0,drb:0,tov:0,ast:0,fgm:0,paint:0,fb:0,ll:0,lc:0,poss:0};
          const fg=pair(st['fieldGoalsMade-fieldGoalsAttempted']),p3=pair(st['threePointFieldGoalsMade-threePointFieldGoalsAttempted']),ft=pair(st['freeThrowsMade-freeThrowsAttempted']);
          x.g++;x.pf+=pf;x.pa+=pa;if(fg){x.fga+=fg[1];x.fgm+=fg[0];}if(p3)x.p3a+=p3[1];if(ft)x.fta+=ft[1];
          x.orb+=+st.offensiveRebounds||0;x.drb+=+st.defensiveRebounds||0;x.tov+=+st.totalTurnovers||+st.turnovers||0;x.ast+=+st.assists||0;
          x.paint+=+st.pointsInPaint||0;x.fb+=+st.fastBreakPoints||0;x.ll+=+st.largestLead||0;x.lc+=+st.leadChanges||0;
          x.poss+=W.possOf(ts);}}
      const o={};for(const [tid,x] of Object.entries(T)){if(x.g<3)continue;
        o[tid]={g:x.g,pace:+(x.poss/x.g).toFixed(1),pts:+(x.pf/x.g).toFixed(1),opp:+(x.pa/x.g).toFixed(1),p3r:x.fga?+(x.p3a/x.fga*100).toFixed(1):null,ftr:x.fga?+(x.fta/x.fga*100).toFixed(1):null,
          tovr:x.poss?+(x.tov/x.poss*100).toFixed(1):null,astr:x.fgm?+(x.ast/x.fgm*100).toFixed(1):null,paint:+(x.paint/x.g).toFixed(1),fb:+(x.fb/x.g).toFixed(1),ll:+(x.ll/x.g).toFixed(1),lc:+(x.lc/x.g).toFixed(1),
          coach:(COACH[sy]&&COACH[sy][tid]&&COACH[sy][tid].n)||null};}
      STY[sy]=o;}
  }catch(e){console.error('球隊風格失敗:',e.message);}

  /* ---------- 5.6) 由「賽前真實傷兵名單」學傷兵係數:比 box score 推缺陣更準(含出賽存疑),
       以前 60% 樣本學、後 40% 驗證,誤差有降才採用;樣本不足前沿用缺陣殘差法 ---------- */
  let injPG=null;
  {
    const K=+E('MARGIN_K');
    const rows=LED.filter(e=>e.pg&&e.pg.u===2&&e.mp!=null&&!e.po&&!e.nu&&!e.nm&&e.pg.f>0&&(e.pg.ih||e.pg.ia))
      .map(e=>{const ph=phM(e);return {x:(e.pg.ih-e.pg.ia)/e.pg.f,y:e.am-K*ph*e.mp};});   /* ih/ia 已是最終分數單位(v3.0 起,u=2) */
    if(rows.length>=150){
      const fit=rs=>{let xy=0,xx=0;rs.forEach(r=>{xy+=r.x*r.y;xx+=r.x*r.x;});return xx>0?xy/xx:0;};
      const cut=Math.floor(rows.length*0.6),tr=rows.slice(0,cut),te=rows.slice(cut);
      const fT=Math.max(0.02,Math.min(0.3,fit(tr)));
      const mae=(rs,f)=>rs.reduce((a,r)=>a+Math.abs(r.y-f*r.x),0)/rs.length;
      const m0=mae(te,inj.f),m1=mae(te,fT);   /* inj.f 與 fT 同為最終分數單位 */
      injPG={n:rows.length,f:+Math.max(0.02,Math.min(0.3,fit(rows))).toFixed(3),fTrain:+fT.toFixed(2),before:+m0.toFixed(3),after:+m1.toFixed(3),adopt:m1<m0-0.005};
      if(injPG.adopt){inj.f=injPG.f;inj.src='pregame';inj.nPG=rows.length;}
      console.log('賽前傷兵係數學習:',JSON.stringify(injPG));
    }else console.log(`賽前傷兵係數學習:樣本 ${rows.length} 場,滿 150 場後啟用`);
  }

  /* ---------- 5.7) 本季對照:我們(開打前凍結的最終預測)vs 市場收盤線 vs ESPN BPI,只比較不混合 ---------- */
  let CMP=null;
  {const rows=LED.filter(e=>e.sy===seasonNow&&!e.po&&!e.nm&&e.mm!=null);
    const stat=(f,lab)=>{const r=rows.filter(e=>f(e)!=null);if(!r.length)return null;const n=r.length;
      return {lab,n,hit:+(r.filter(e=>(f(e)>=0)===(e.am>0)).length/n*100).toFixed(1),mae:+(r.reduce((a,e)=>a+Math.abs(e.am-f(e)),0)/n).toFixed(2),
        full:+(r.filter(e=>{const t=MBT.g.length?mbPickT(MBT.g,f(e)).i:mbPickN(f(e),sigmaM);return t===homeIdx(e);}).length/n*100).toFixed(1)};};
    CMP={n:rows.length,ours:stat(e=>e.mm,'我們'),mkt:stat(e=>e.mk!=null?e.mk:null,'市場收盤線'),bpi:stat(e=>(e.bpi&&e.bpi.pre&&e.bpi.pd!=null)?e.bpi.pd:null,'ESPN BPI')};
    console.log('本季對照:',JSON.stringify(CMP));}

  /* ---------- 6) 輸出 ---------- */
  const hist=(prev.hist||[]).filter(h=>h.d!==today);
  if(hit!=null)hist.push({d:today,s:S,k:K,hit:+(hit*100).toFixed(1),mb:mbRate(win),n:samples.length});
  while(hist.length>HIST_MAX)hist.shift();
  const bySy={};LED.forEach(e=>{(bySy[e.sy]=bySy[e.sy]||[]).push(e);});
  const seasons=Object.keys(bySy).map(Number).sort((a,b)=>a-b).map(sy=>{
    const all=bySy[sy],rg=all.filter(e=>!e.po&&!e.nu),rp=rg.filter(e=>!e.nm);
    return {s:sy,n:rg.length,nm:rg.length-rp.length,po:all.filter(e=>e.po).length,nu:all.filter(e=>e.nu).length,
      hit:rp.length?+(rp.filter(e=>e.hit).length/rp.length*100).toFixed(1):null,
      hitF:rp.some(e=>e.hf!=null)?+(rp.filter(e=>e.hf).length/rp.filter(e=>e.hf!=null).length*100).toFixed(1):null,   /* 最終預測(含盤口、傷兵)命中率 */
      mae:rp.length?+(rp.reduce((a,e)=>a+Math.abs(e.am-e.m*K),0)/rp.length).toFixed(1):null,
      mb:(sy===seasonNow&&rp.some(e=>e.mbh!=null))?+(rp.filter(e=>e.mbh).length/rp.filter(e=>e.mbh!=null).length*100).toFixed(1):mbRate(rp),   /* 本季用凍結的預測,歷史以現行表回算 */
      pl:all.filter(e=>e.pl&&e.pl.h&&e.pl.a).length};});
  const health={withPb:LED.filter(e=>e.pb).length,withOf:LED.filter(e=>e.of).length,withOd:LED.filter(e=>e.od).length,withBx:LED.filter(e=>e.bx).length,withPg:LED.filter(e=>e.pg).length,withTs:LED.filter(e=>e.ts).length,withF:LED.filter(e=>e.f).length,games:LED.length,reg:LED.filter(e=>!e.po).length,po:LED.filter(e=>e.po).length,withPl:LED.filter(e=>e.pl).length,
    fixed,added,errors,fitN:samples.length,pdb:pdbN,seasonsN:seasons.length,seasons,secs:Math.round((Date.now()-t0)/1000)};
  const fit={variant,prm:PRMF,K:KF,coef:coefF,trainN:finalTrain.length,win:WIN,bt,tot,hcaBySeason,phEval};
  const calib={k:K,sigma:S,injF:inj.f,inj,injPG,prm:PRMF,mb:MBT,styles:STY,cmp:CMP,fit,hist,ledger:LED.slice(-CLIENT_LEDGER).map(slim),
    last:LED.length?LED[LED.length-1].d:null,updated:new Date().toISOString(),window:FIT_DAYS,health};
  fs.writeFileSync(F_CALIB,JSON.stringify(calib));
  for(const sy of Object.keys(bySy)){
    const f=path.join(D_SEED,`ledger-${sy}.json`);const txt=JSON.stringify(bySy[sy]);
    if(!fs.existsSync(f)||fs.readFileSync(f,'utf8')!==txt)fs.writeFileSync(f,txt);
  }
  for(const f of Object.keys(PBP_DAYS)){const dir=path.dirname(f);if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(f,zlib.gzipSync(Buffer.from(JSON.stringify(PBP_DAYS[f]),'utf8'),{level:9}));
    const old=f.replace(/\.gz$/,'');if(fs.existsSync(old))fs.unlinkSync(old);}
  if(Object.keys(PBP_DAYS).length)console.log(`逐球紀錄寫入 ${Object.keys(PBP_DAYS).length} 個日期檔(gzip)`);
  /* 舊的未壓縮逐球檔一次轉成 gzip */
  for(const dir of fs.readdirSync(D_SEED).filter(x=>/^pbp-\d{4}$/.test(x))){const dp=path.join(D_SEED,dir);
    for(const fn of fs.readdirSync(dp).filter(x=>/\.json$/.test(x))){const f=path.join(dp,fn);
      if(!fs.existsSync(f+'.gz'))fs.writeFileSync(f+'.gz',zlib.gzipSync(fs.readFileSync(f),{level:9}));fs.unlinkSync(f);}}
  fs.writeFileSync(F_META,JSON.stringify(meta));
  if(fs.existsSync(F_SEED_OLD))fs.unlinkSync(F_SEED_OLD);
  console.log('完成:',JSON.stringify({k:K,sigma:S,injF:inj.f,hit:hit!=null?+(hit*100).toFixed(1):null,...health,seasons:undefined}));
  seasons.forEach(x=>console.log(`  ${x.s-1}-${String(x.s).slice(2)}  例行賽 ${x.n}  季後賽 ${x.po}  中立場 ${x.nu}  命中 ${x.hit}%  分差誤差 ${x.mae}  球員數據 ${x.pl}`));
  dom.window.close();
  process.exit(0);
})().catch(e=>{console.error('校準失敗:',e);process.exit(1);});
