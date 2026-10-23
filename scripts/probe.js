/* 資料源探測 2:印出候選資料的實際結構(截斷),只讀不寫 */
const get=async(u,json=true)=>{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 (nba-scoreboard-probe)'},signal:AbortSignal.timeout(20000)});const t=await r.text();return json?JSON.parse(t):t;};
const strip=o=>JSON.parse(JSON.stringify(o,(k,v)=>(/^(links|logo|logos|uid|\$ref)$/.test(k)?undefined:v)));
(async()=>{
  try{const p=await get('https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/predictor');console.log('PREDICTOR',JSON.stringify(strip(p)).slice(0,1500));}catch(e){console.log('PREDICTOR ERR',e.message);}
  try{const o=await get('https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/odds');
    console.log('ODDS count',o.count);for(const it of o.items.slice(0,3))console.log('ODDS item',JSON.stringify(strip(it)).slice(0,900));}catch(e){console.log('ODDS ERR',e.message);}
  try{const h=await get('https://official.nba.com/referee-assignments/',false);const i=h.indexOf('Referee');const body=h.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'');
    const txt=body.replace(/<[^>]+>/g,'|').replace(/\s+/g,' ').replace(/(\|\s*)+/g,'|');const j=txt.indexOf('Game');console.log('REF TEXT',txt.slice(Math.max(0,j-200),j+1500));
    const tbl=/<table[\s\S]*?<\/table>/i.exec(h);console.log('REF TABLE',tbl?tbl[0].replace(/\s+/g,' ').slice(0,1500):'(no table)');}catch(e){console.log('REF ERR',e.message);}
  try{const h=await get('https://official.nba.com/nba-injury-report-2025-26-season/',false);const links=[...h.matchAll(/href="([^"]+\.pdf)"/g)].map(m=>m[1]);console.log('INJ PDF links',links.length,links.slice(0,5));
    const h2=await get('https://official.nba.com/nba-injury-report-2026-27-season/',false).catch(()=>'');const l2=[...h2.matchAll(/href="([^"]+\.pdf)"/g)].map(m=>m[1]);console.log('INJ PDF links 2026-27',l2.length,l2.slice(0,5));}catch(e){console.log('INJ ERR',e.message);}
  try{const s=await get('https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/teams/13/statistics');const cats=(s.splits&&s.splits.categories||[]).map(c=>c.name+':'+(c.stats||[]).map(x=>x.name).slice(0,40).join(','));console.log('TEAM STATS',cats.join(' || ').slice(0,1800));}catch(e){console.log('TEAMSTATS ERR',e.message);}
  try{const t=await get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/transactions?limit=3');console.log('TX',JSON.stringify(strip(t.transactions||t)).slice(0,700));}catch(e){console.log('TX ERR',e.message);}
  try{const p=await get('https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401585183/competitions/401585183/predictor');console.log('PREDICTOR 2024',JSON.stringify(strip(p)).slice(0,400));}catch(e){console.log('PREDICTOR 2024 ERR',e.message);}
})();
