const fs=require('fs'),M=require('../../scripts/margin-model'),Q=require('../../scripts/quality-model');
const all=fs.readdirSync('research/data/seed').filter(f=>/^ledger-\d{4}\.json$/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync('research/data/seed/'+f))),rows=M.clean(all,'2026-07-01');
const out=rows.map(e=>({id:e.id,d:e.d,sy:e.sy,hid:e.hid,aid:e.aid,am:e.am,hpts:e.hs??e.ts?.h?.[0],apts:e.as??e.ts?.a?.[0],H:Q.shots(e,'h'),A:Q.shots(e,'a')}));
for(const e of out)if(!Number.isFinite(e.hpts)||!Number.isFinite(e.apts)||e.hpts-e.apts!==e.am)throw Error('Score mismatch '+e.id);
fs.writeFileSync('research/v13/source.json',JSON.stringify(out));console.log(JSON.stringify({rows:out.length,withShots:out.filter(e=>e.H&&e.A).length}));
