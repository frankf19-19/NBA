'use strict';
const PM=require('./player-model.cjs'),assert=require('assert');
const w=PM.ols([{a:1,am:3},{a:2,am:5},{a:3,am:7},{a:4,am:9}],r=>[1,r.a]);assert.ok(Math.abs(w[0]-1)<1e-6&&Math.abs(w[1]-2)<1e-6,'ols');
const M={players:{1:{r:.1,b:1,em:30},2:{r:-.05,b:.5,em:30},3:{r:0,b:.6,em:20}}};
const full=PM.teamStrength(M,[1,2,3],{}),noStar=PM.teamStrength(M,[1,2,3],{1:0});
assert.ok(full&&noStar&&noStar[0]<full[0],'主力缺陣使正負值實力下降');
// 時序:replay 產生的特徵只用賽前資料(同一球員首場無歷史 → 該場特徵為 0)
const mkG=(id,d,pm)=>({id,d,sy:2027,st:2,po:0,am:pm,mp:0,m:0,hid:1,aid:2,pl:{h:[{id:10,min:30,pm,pts:20}],a:[{id:20,min:30,pm:-pm,pts:10}]}});
const {rows}=PM.replay([mkG('a','2026-10-21',10),mkG('b','2026-10-23',10)]);
assert.equal(rows[0].x,0,'首場不得使用本場結果');assert.ok(rows[1].x>0,'第二場使用前一場');
console.log('player-model 測試通過');
// 缺陣衝擊:主力連打多場後缺陣,該場特徵應為負(對缺陣方不利),且只在剛缺陣時出現
{const mk=(i,star)=>({id:'g'+i,d:'2026-11-'+String(i+1).padStart(2,'0'),sy:2027,st:2,po:0,am:5,mp:0,m:0,hid:1,aid:2,
  pl:{h:[...(star?[{id:10,min:36,pm:8,pts:30,reb:8,ast:8}]:[]),{id:11,min:30,pm:2,pts:8},{id:12,min:30,pm:2,pts:8}],a:[{id:20,min:30,pm:-5,pts:10},{id:21,min:30,pm:-5,pts:10}]}});
 const L=[];for(let i=0;i<8;i++)L.push(mk(i,true));for(let i=8;i<14;i++)L.push(mk(i,false));
 const {rows}=PM.replay(L);assert.equal(rows[7].xab,0,'有上場時無衝擊');assert.ok(rows[8].xab<0,'剛缺陣:產出衝擊為負');assert.equal(rows[13].xab,0,'缺陣超過門檻後不再計入');}
console.log('player-model 缺陣衝擊測試通過');
