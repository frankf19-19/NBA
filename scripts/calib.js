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
/* 版本:v1.7.1(休息天數美東日期修正)v1.7(參數學習 + 攻守效率 + 公平回測)v1.6.3(同場重複登錄去重、賽季依日期推算、收錄無預測場次) 1994-95 季起全部賽季(不用 localStorage) + 失敗日期重試 + 排除表演賽與空殼場次 */

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
const slim=e=>{const o={id:e.id,d:e.d,sy:e.sy,aw:e.aw,hm:e.hm,hid:e.hid,aid:e.aid,m:e.m,am:e.am,hit:e.hit};if(e.mp!=null)o.mp=e.mp;if(e.ts)o.ts=e.ts;if(e.st!=null)o.st=e.st;if(e.po)o.po=1;if(e.nu)o.nu=1;if(e.nm)o.nm=1;return o;};
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
  /* 紀錄簿不放 localStorage(上限 500 萬字元,數萬場會爆):
     預測某日時,把「該日之前最近 3,000 場」直接交給網頁的 ledger(),逐隊偏差只需每隊最近 12 場,且不偷看未來 */
  let CUR=[];
  W.ledger=()=>CUR;
  const before=d=>{let lo=0,hi=LED.length;while(lo<hi){const mid=(lo+hi)>>1;if(LED[mid].d<d)lo=mid+1;else hi=mid;}return lo;};
  const setCur=d=>{const i=before(d);CUR=LED.slice(Math.max(0,i-3000),i);};

  /* ---------- 0) 球員數據 + 球隊數據(box score);掃描前先補,攻守效率才有資料可用 ---------- */
  const fetchBox=async(label)=>{
    const todo=LED.filter(e=>(!e.pl||!e.ts)&&!e.tsx);
    let n=0;
    for(let i=0;i<todo.length;i+=PL_BATCH){
      await Promise.all(todo.slice(i,i+PL_BATCH).map(async e=>{
        try{const r=W.parsePlayerLines(await W.jget(`${E('SB')}/summary?event=${e.id}`));
          if(r){if(!e.pl)e.pl=JSON.parse(JSON.stringify(r.pl));e.hid=r.hid;e.aid=r.aid;
            if(r.ts)e.ts=JSON.parse(JSON.stringify(r.ts));else e.tsx=1;n++;}
          else e.tsx=1;}catch(err){}
      }));
      if(i&&i%1200===0)console.log(`${label} ${i}/${todo.length}`);
    }
    console.log(`${label}:處理 ${n}/${todo.length} 場`);
  };
  await fetchBox('box score(掃描前)');

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
          if(x.nm)e.nm=1;
          if(x.f)e.f=JSON.parse(JSON.stringify(x.f));
          if(e.d>=BUBBLE[0]&&e.d<BUBBLE[1])e.nu=1;
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

  /* ---------- 3) 擬合 K / σ(例行賽、最近 FIT_DAYS 天,含阻尼;首次回補多輪收斂) ---------- */
  const reg=LED.filter(e=>!e.po&&!e.nu&&!e.nm);
  const fitEnd=reg.length?reg[reg.length-1].d:null;
  const win=fitEnd?reg.filter(e=>e.d>shiftDate(fitEnd,-FIT_DAYS)):[];
  const samples=win.map(e=>({m:(e.mp??e.m),actM:e.am,homeWon:e.am>0}));
  let hit=null;
  if(samples.length>=30){
    const rounds=(bootstrap||prmChanged)?6:1;
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
  const bySy={};LED.forEach(e=>{(bySy[e.sy]=bySy[e.sy]||[]).push(e);});
  const seasons=Object.keys(bySy).map(Number).sort((a,b)=>a-b).map(sy=>{
    const all=bySy[sy],rg=all.filter(e=>!e.po&&!e.nu),rp=rg.filter(e=>!e.nm);
    return {s:sy,n:rg.length,nm:rg.length-rp.length,po:all.filter(e=>e.po).length,nu:all.filter(e=>e.nu).length,
      hit:rp.length?+(rp.filter(e=>e.hit).length/rp.length*100).toFixed(1):null,
      mae:rp.length?+(rp.reduce((a,e)=>a+Math.abs(e.am-e.m*K),0)/rp.length).toFixed(1):null,
      pl:all.filter(e=>e.pl&&e.pl.h&&e.pl.a).length};});
  const health={withTs:LED.filter(e=>e.ts).length,withF:LED.filter(e=>e.f).length,games:LED.length,reg:LED.filter(e=>!e.po).length,po:LED.filter(e=>e.po).length,withPl:LED.filter(e=>e.pl).length,
    fixed,added,errors,fitN:samples.length,pdb:pdbN,seasonsN:seasons.length,seasons,secs:Math.round((Date.now()-t0)/1000)};
  const fit={variant,prm:PRMF,K:KF,coef:coefF,trainN:finalTrain.length,win:WIN,bt,tot,hcaBySeason};
  const calib={k:K,sigma:S,injF:inj.f,inj,prm:PRMF,fit,hist,ledger:LED.slice(-CLIENT_LEDGER).map(slim),
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
