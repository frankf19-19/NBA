'use strict';
/* 官方傷兵報告快速更新(輕量,不跑模型):每 20 分鐘抓 NBA 官方最新一版傷兵報告 PDF,解析後寫成 injury-latest.json。
   網頁載入當天比賽時讀這個檔,以官方狀態覆寫 ESPN 名單(ESPN 常停在前一天的狀態)。
   解析規則與 scripts/calib.js 的官方傷兵段落相同;發布時間以 PDF 內文為準(InjuryTime.publication)。 */
const fs=require('fs'),path=require('path');
const InjuryTime=require('./injury-report-time.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'injury-latest.json');
const readJSON=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return d;}};
(async()=>{
  const now=new Date();
  const ym=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).format(now).split('-').map(Number);
  const sy=ym[1]>=8?ym[0]+1:ym[0];
  const prev=readJSON(OUT,null);
  const pdb=readJSON(path.join(ROOT,'pdb.json'),{teams:{}});
  const TEAMGLUED=[...new Set(Object.values(pdb.teams||{}).map(t=>String(t.n||'').replace(/\s+/g,'')).filter(Boolean))].sort((a,b)=>b.length-a.length);
  const idx=await (await fetch(`https://official.nba.com/nba-injury-report-${sy-1}-${String(sy).slice(2)}-season/`,{headers:{'User-Agent':'Mozilla/5.0 (nba-scoreboard)'},signal:AbortSignal.timeout(20000)})).text();
  const links=[...new Set([...idx.matchAll(/href="([^"]*Injury-Report_(\d{4}-\d\d-\d\d)_(\d\d)_(\d\d)([AP]M)\.pdf)"/gi)].map(m=>JSON.stringify({u:m[1],d:m[2],h:(+m[3]%12)+(m[5].toUpperCase()==='PM'?12:0),mi:+m[4]})))].map(x=>JSON.parse(x))
    .sort((a,b)=>(b.d+String(b.h).padStart(2,'0')+String(b.mi).padStart(2,'0')).localeCompare(a.d+String(a.h).padStart(2,'0')+String(a.mi).padStart(2,'0')));
  let L0=null,buf=null;
  for(const L of links.slice(0,12)){try{const r=await fetch(L.u,{signal:AbortSignal.timeout(30000)});if(r.ok){const b=Buffer.from(await r.arrayBuffer());if(b.length>2000&&b.slice(0,4).toString()==='%PDF'){L0=L;buf=b;break;}}}catch(e){}}
  if(!L0){console.log('沒有抓到可用的官方傷兵報告 PDF');return;}
  const key=`${L0.d}_${String(L0.h).padStart(2,'0')}${String(L0.mi).padStart(2,'0')}`;
  if(prev&&prev.key===key){console.log('最新版已存過',key);return;}
  const text=(await require('pdf-parse')(buf)).text||'';
  const publishedAt=InjuryTime.publication(text);
  if(!publishedAt||Date.parse(publishedAt)>Date.now())throw new Error('官方傷兵報告內文發布時間無法核實或晚於現在');
  if(prev&&prev.publishedAt&&Date.parse(prev.publishedAt)>Date.parse(publishedAt)){console.log('抓到的版本比已存的舊,略過');return;}
  const rows=[];let gd='',gt='',game='',team='';
  for(const raw of text.split(/\n/)){const ln=raw.replace(/\s+/g,'').trim();if(!ln||/^InjuryReport:|^Page\d|^GameDate/.test(ln))continue;
    const m=/^(?:(\d\d\/\d\d\/\d{4}))?(?:(\d\d:\d\d)\(ET\))?(?:([A-Z]{3}@[A-Z]{3}))?(.*?)(Out|Doubtful|Questionable|Probable|Available)(.*)$/.exec(ln);
    if(m){if(m[1])gd=m[1];if(m[2])gt=m[2];if(m[3])game=m[3];
      let mid=m[4]||'';const tn=TEAMGLUED.find(t=>mid.startsWith(t));if(tn){team=tn;mid=mid.slice(tn.length);}
      const pm=/([A-Z][A-Za-z.'\-]*(?:,[A-Z][A-Za-z.'\-]*)+)$/.exec(mid);const pl=pm?pm[1]:mid;
      const parts=pl.split(',');const first=parts[parts.length-1],last=parts[0],suf=parts.length>2?parts.slice(1,-1).join(' '):'';
      rows.push({d:gd,tm:gt,g:game,team,p:`${first} ${last}${suf?' '+suf:''}`.trim(),s:m[5],r:m[6]||''});}
    else if(rows.length)rows[rows.length-1].r+=ln;}
  rows.forEach(x=>{x.r=x.r.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/-/g,' - ').replace(/\s+/g,' ').slice(0,80);});
  if(rows.length<5)throw new Error('解析列數過少('+rows.length+'),不覆寫');
  fs.writeFileSync(OUT,JSON.stringify({v:1,key,publishedAt,fetchedAt:now.toISOString(),url:L0.u,n:rows.length,rows}));
  console.log(`官方傷兵報告 ${key}(內文發布 ${publishedAt}),${rows.length} 列`);
})().catch(e=>{console.error('失敗:',e.message);process.exit(0);});
