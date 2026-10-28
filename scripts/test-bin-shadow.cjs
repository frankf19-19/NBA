const assert=require('node:assert/strict'),B=require('./bin-shadow.cjs'),artifact=require('../bin-shadow.json');
const q=Array(12).fill(1/12),g={id:'123',homeId:1,awayId:2,stype:2,startISO:'2026-10-29T00:00Z'},date='2026-10-28',options={at:'2026-10-28T23:00Z',pointVersion:'quality-v1'};
const before=JSON.stringify({artifact,g,q}),a=B.forecast(artifact,g,3,date,q,options);assert(a);assert.equal(JSON.stringify({artifact,g,q}),before);assert.equal(a.pointEnabled,false);assert.equal(a.margin,3);assert(B.validQ(a.probabilities));
for(const f of require('../research/v10/parity.json')){const p=B.forecast(artifact,g,f.margin,date,f.baseline,options);p.probabilities.forEach((x,k)=>assert(Math.abs(x-f.expected[k])<1e-7));}
const mirrored=B.forecast(artifact,g,-3,date,q,options);a.probabilities.forEach((v,k)=>assert(Math.abs(v-mirrored.probabilities[(k+6)%12])<1e-12));
for(const patch of [{pointEnabled:true},{mode:'formal'},{automaticPromotion:true},{season:2026},{trainedThrough:date},{weight:1},{version:'bad'}])assert.equal(B.forecast({...artifact,...patch},g,3,date,q,options),null);
for(const patch of [{stype:1},{stype:3},{stype:5},{neutralSite:true},{cupFinal:true},{homeId:31},{awayId:1},{id:'401607494'}])assert.equal(B.forecast(artifact,{...g,...patch},3,date,q,options),null);
assert.equal(B.forecast(artifact,g,3,date,q,{...options,at:g.startISO}),null);assert.equal(B.forecast(artifact,g,3,date,q,{...options,pointVersion:null}),null);assert.equal(B.forecast(artifact,g,NaN,date,q,options),null);assert.equal(B.forecast(artifact,g,3,date,Array(12).fill(.1),options),null);
const e={id:g.id,d:date,st:2,hid:1,aid:2,am:4,tip:g.startISO,pg:{qv:'quality-v1',at:options.at,tip:g.startISO,mm:3,q,binShadow:a}},original=JSON.stringify(e),r=B.score([e,e]);assert.equal(r.n,1);assert.equal(JSON.stringify(e),original);assert.equal(r.baseline.logloss,Math.log(12));assert.equal(r.automaticPromotion,false);
for(const patch of [{am:NaN},{am:0},{po:1},{nu:1},{cf:1},{st:5},{hid:99},{d:null},{tip:'2026-10-28T20:00Z'}])assert.equal(B.score([{...e,...patch}]).n,0);
for(const patch of [{mm:4},{q:Array(12).fill(.1)},{qv:'other'},{at:g.startISO}])assert.equal(B.score([{...e,pg:{...e.pg,...patch}}]).n,0);
for(const patch of [{at:g.startISO},{trainedThrough:date},{margin:5},{gid:'other'},{pointEnabled:true},{probabilities:[]}])assert.equal(B.score([{...e,pg:{...e.pg,binShadow:{...a,...patch}}}]).n,0);
assert.equal(B.score([]).baseline,null);
console.log('Bin shadow checks passed: independent Python/JS parity, mirror symmetry, normalization, strict domain/time/version, immutable input, simultaneous baseline and actual-tip paired scoring.');
