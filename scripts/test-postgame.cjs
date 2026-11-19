'use strict';
const PG=require('./postgame.cjs'),assert=require('assert');
const row=(id,min,pts,p3,ft,to)=>[id,1,0,min,pts,'0-0',p3,ft,0,0,to,0,0,0,0,0,0];
const g=(i,h3,hto)=>({id:'g'+i,d:'2026-11-'+String(i+1).padStart(2,'0'),sy:2027,st:2,hid:1,aid:2,hm:'Home Team',aw:'Away Team',am:5,pg:{mm:2},
  bx:{h:{p:[row(10,34,20,h3,'4-5',hto),row(11,30,10,'2-6','2-2',1)]},a:{p:[row(20,34,18,'3-9','3-4',2),row(21,30,12,'3-8','1-2',1)]}},ls:{h:[25,25,25,25],a:[24,24,24,24]}});
const prior=[];for(let i=0;i<8;i++)prior.push(g(i,'3-9',2));
const hot=g(9,'9-12',2),r=PG.explain(hot,prior,{hn:[],an:[]},{10:{n:'Hot Shooter'},11:{n:'B'},20:{n:'C'},21:{n:'D'}},{p3:.35,ft:.78});
assert.ok(r&&r.r.some(x=>x.k==='三分'&&x.v>0),'主隊三分手感火燙應列為原因且對主隊有利');
assert.equal(r.miss,3,'預測差距 = 實際 − 賽前凍結預測');
const scratch=g(10,'3-9',2);scratch.bx.h.p=[row(11,40,14,'2-6','2-2',1)];
const r2=PG.explain(scratch,prior,{hn:[],an:[]},{10:{n:'Hot Shooter'},11:{n:'B'},20:{n:'C'},21:{n:'D'}},{p3:.35,ft:.78});
assert.ok(r2.r.some(x=>x.k==='臨時缺陣'&&/Hot Shooter/.test(x.s)),'賽前名單沒列卻沒上場 → 臨時缺陣');
const r3=PG.explain(scratch,prior,{hn:['Hot Shooter(場均 20 分,確定缺陣)'],an:[]},{10:{n:'Hot Shooter'},11:{n:'B'},20:{n:'C'},21:{n:'D'}},{p3:.35,ft:.78});
assert.ok(!r3.r.some(x=>x.k==='臨時缺陣'),'賽前已列缺陣就不算臨時');
console.log('postgame 測試通過');
