'use strict';
const T=require('./player-tune.cjs'),PM=require('./player-model.cjs'),assert=require('assert');
assert.ok(T.GATE.minImprove>0&&T.GATE.minSeasonsImproved>=5,'採用門檻必須存在');
for(const k of PM.TUNABLE)assert.ok(T.STEP[k]&&T.STEP[k].min<T.STEP[k].max,'每個可調參數都有上下界: '+k);
/* withCfg 只影響呼叫期間,結束後恢復預設 */
const before=PM.CFG.decay;PM.withCfg({decay:0.9},()=>assert.equal(PM.CFG.decay,0.9));assert.equal(PM.CFG.decay,before);
/* 不允許改不可調的欄位 */
PM.withCfg({firstSeason:1990,decay:0.97},()=>{assert.equal(PM.CFG.firstSeason,PM.BASE_CFG.firstSeason);assert.equal(PM.CFG.decay,0.97);});
console.log('player-tune 測試通過');
