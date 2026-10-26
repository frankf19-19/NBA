const assert=require('node:assert/strict'),M=require('./margin-model');
const eps=1e-12;
for(const [x,k] of [[1,0],[5,0],[6,1],[25,4],[26,5],[-1,6],[-26,11]])assert.equal(M.actual(x),k);
const artifact={schema:1,enabled:true,season:2027,trainedThrough:'2026-10-25',grid:{step:.25,probabilities:Array.from({length:161},(_,i)=>M.normal(i*.25,14))}};
for(let m=-40;m<=40;m+=.125){const p=M.probabilities(artifact,m,'2026-10-26'),q=M.probabilities(artifact,-m,'2026-10-26');assert(p.every(Number.isFinite));assert(p.every(v=>v>=0));assert(Math.abs(p.reduce((s,v)=>s+v,0)-1)<eps);p.forEach((v,i)=>assert(Math.abs(v-q[(i+6)%12])<eps));}
for(const date of ['2026-10-24','2026-10-25','2026-11-02'])assert.equal(M.probabilities(artifact,3,date),null);
const e=(id,d,h,a,am)=>({id,d,hid:h,aid:a,am,sy:2027,f:{b:2,x:Array(7).fill(0)}});
const past=[e('1','2026-10-20',1,2,10),e('2','2026-10-20',1,3,-8),e('3','2026-10-21',1,2,5)];
const a=M.featureRows(M.clean(past)),b=M.featureRows(M.clean([...past,e('4','2026-10-22',1,2,50)]));assert.deepEqual(a.rows.map(r=>r.x),b.rows.slice(0,3).map(r=>r.x));assert.deepEqual(a.rows[0].x.slice(-3),a.rows[1].x.slice(-3));assert.equal(M.clean(past,'2026-10-21').length,2);
console.log('Margin unit checks passed: causal day batching, cutoff, class boundaries, symmetry, normalization, stale model fallback.');
