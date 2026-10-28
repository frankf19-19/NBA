const assert=require('node:assert/strict'),O=require('./pregame-observations.cjs'),T=require('./pregame-timing-audit.cjs');
const g={id:'1',homeId:1,awayId:2,stype:2,startISO:'2026-10-29T00:00Z'},date='2026-10-28',base={tip:g.startISO,mm:3,qv:'quality-v1',qn:'regress3',q:Array(12).fill(1/12)};
let archive=O.append(null,g,{...base,at:'2026-10-28T20:59Z'},date,{savedAt:'2026-10-28T21:00Z'});archive=O.append(archive,g,{...base,mm:5,at:'2026-10-28T23:29Z'},date,{savedAt:'2026-10-28T23:30Z'});
const e={id:'1',d:date,hid:1,aid:2,st:2,am:6,tip:g.startISO},frozen=JSON.stringify(archive),r=T.build([e,e],archive);assert.equal(r.n,1);assert.equal(r.early.mae,3);assert.equal(r.near.mae,1);assert.equal(r.probabilityPairs,1);assert.equal(JSON.stringify(archive),frozen);assert.equal(r.automaticPromotion,false);assert.deepEqual(T.build([{...e,am:-30}],archive).pairs,r.pairs);
for(const patch of [{po:1},{nu:1},{cf:1},{st:5},{am:0},{am:NaN},{tip:'2026-10-29T01:00Z'}])assert.equal(T.build([{...e,...patch}],archive).n,0);
assert.equal(T.build([e],{...archive,observations:archive.observations.slice(0,1)}).n,0);
for(const patch of [{savedAt:g.startISO},{savedAt:'bad'},{qualityVersion:'other'},{tip:'2026-10-29T01:00Z'},{homeId:9}]){const changed={...archive,observations:[archive.observations[0],{...archive.observations[1],...patch}]};assert.equal(T.build([e],changed).n,0);}
const empty=T.build([],null);assert.equal(empty.n,0);assert.equal(empty.early,null);
console.log('Pregame timing audit checks passed: fixed windows, latest snapshot chosen without outcomes, paired version/tip/domain, deduplication, no fabricated pairs or input mutation.');
