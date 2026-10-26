const assert=require('node:assert/strict'),M=require('./margin-model'),Q=require('./quality-model');
function game(id,d,h,a,hot=false){const H=[30,60,hot?20:12,30,15,20,10,30,10,hot?135:111],A=[26,60,10,30,12,16,8,27,13,94];const tst=v=>({'fieldGoalsMade-fieldGoalsAttempted':`${v[0]+v[2]}-${v[1]+v[3]}`,'threePointFieldGoalsMade-threePointFieldGoalsAttempted':`${v[2]}-${v[3]}`,'freeThrowsMade-freeThrowsAttempted':`${v[4]}-${v[5]}`,offensiveRebounds:v[6],defensiveRebounds:v[7],totalTurnovers:v[8]});return {id,d,sy:2027,hid:h,aid:a,am:H[9]-A[9],f:{b:2,x:Array(7).fill(0)},ts:{h:[H[9],90,20,10,10],a:[A[9],90,16,8,13]},tst:{h:tst(H),a:tst(A)}};}
const games=[game('1','2026-10-20',1,2),game('2','2026-10-22',1,3),game('3','2026-10-23',1,4)];
const a=Q.featureRows(games),b=Q.featureRows([...games,game('4','2026-10-24',1,2,true)]);assert.deepEqual(a.rows.map(r=>r.x),b.rows.slice(0,3).map(r=>r.x));assert.equal(a.rows[2].x[5],1);assert.equal(a.usable,3);
const same=Q.featureRows([games[0],{...games[1],d:games[0].d}]);assert.deepEqual(same.rows[0].x.slice(11,14),same.rows[1].x.slice(11,14));
const cold=Q.featureRows([games[0]]).state,hot=Q.featureRows([game('1','2026-10-20',1,2,true)]).state;
assert(Math.abs(hot.ratings[1][0][1]-cold.ratings[1][0][1])<Math.abs(hot.ratings[0][0][1]-cold.ratings[0][0][1]));
const sample=Array.from({length:2200},()=>({y:1,p:[6,5,3,4,4,4]}));assert.equal(Q.choose(sample).index,2);assert.equal(Q.choose(sample.slice(0,100)).index,0);
const hist=Array.from({length:1000},(_,i)=>({base:(i%21)-10,y:(i%37)-18||1})),grid=Q.grid(hist);for(let v=-35;v<=35;v+=.5){const p=Q.atGrid(grid,v);assert(p.every(x=>x>=0&&Number.isFinite(x)));assert(Math.abs(p.reduce((s,x)=>s+x,0)-1)<1e-12);}
console.log('Quality unit checks passed: no future/same-day leakage, correct 3-in-4 fatigue, bounded shooting-regression reaction, past-only selection safeguards, probability normalization.');
