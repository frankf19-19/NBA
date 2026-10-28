const assert=require('node:assert/strict'),A=require('./forecast-audit.cjs');
const game=(id='1')=>({id,d:'2026-10-27',hid:1,aid:2,am:6,tip:'2026-10-28T00:00Z',pg:{qv:'quality-v1',at:'2026-10-27T23:00Z',tip:'2026-10-28T00:00Z',mm:5,baseMargin:3,mb:1,q:Array.from({length:12},(_,i)=>i===1?1:0),interval:{lo:0,hi:10,coverage:.8}}});
const e=game(),before=JSON.stringify(e),r=A.build([e]);assert.equal(JSON.stringify(e),before);assert.equal(r.n,1);assert.equal(r.selected.mae,1);assert.equal(r.baseline.mae,3);assert.equal(r.maeDifference,-2);assert.equal(r.bins.hits,1);assert.equal(r.bins.brier,0);assert.equal(r.bins.logloss,0);assert.equal(r.intervals.coverage,1);assert.equal(r.automaticPromotion,false);
assert.equal(A.build([e,e,{...e,id:'other'}]).n,1);
for(const patch of [{po:1},{nu:1},{cf:1},{st:1},{nm:1},{am:NaN},{am:0},{hid:31},{aid:1},{id:'401607494'}])assert.equal(A.build([{...e,...patch}]).n,0);
for(const patch of [{at:'2026-10-28T00:00Z'},{at:'invalid'},{qv:'other'},{baseMargin:NaN},{tip:'2026-10-28T01:00Z'}])assert.equal(A.build([{...e,pg:{...e.pg,...patch}}]).n,0);
assert.equal(A.build([{...e,tip:'2026-10-27T22:00Z'}]).n,0);
for(const q of [[],Array(12).fill(.1),[...e.pg.q.slice(0,11),NaN],[-1,2,...Array(10).fill(0)]]){const a=A.build([{...e,pg:{...e.pg,q}}]);assert.equal(a.n,1);assert.equal(a.bins.probabilityN,0);assert.equal(a.bins.brier,null);}
const none=A.build([]);assert.equal(none.selected,null);assert.equal(none.bins.accuracy,null);assert.equal(none.intervals.coverage,null);
console.log('Frozen forecast audit checks passed: actual-tip verification, domain/version filtering, deduplication, proper bin scores, interval coverage, immutable inputs and empty-sample handling.');
