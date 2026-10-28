const fs=require('fs'),M=require('../../scripts/margin-model'),Q=require('../../scripts/quality-model');
const all=fs.readdirSync('research/data/seed').filter(f=>/^ledger-\d{4}\.json$/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync('research/data/seed/'+f))),rows=M.clean(all,'2026-07-01');
const meta=rows.map(e=>({id:e.id,d:e.d,sy:e.sy,hid:e.hid,aid:e.aid,am:e.am,H:Q.shots(e,'h'),A:Q.shots(e,'a')}));fs.writeFileSync('research/v12/source.json',JSON.stringify(meta));console.log(JSON.stringify({rows:meta.length,withShots:meta.filter(e=>e.H&&e.A).length}));
