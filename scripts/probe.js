const get=async(u)=>{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 (nba-scoreboard-probe)'},signal:AbortSignal.timeout(20000)});return r.text();};
(async()=>{for(const u of ['https://official.nba.com/nba-injury-report-2026-27-season/','https://official.nba.com/nba-injury-report-2025-26-season/']){
  try{const h=await get(u);const links=[...new Set([...h.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(x=>/injur/i.test(x)))];console.log(u,'injury links',links.length);links.slice(0,15).forEach(x=>console.log('  ',x));
    const i=h.search(/Injury Report/i);console.log('  ctx:',h.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1200));}catch(e){console.log(u,'ERR',e.message);}}})();
