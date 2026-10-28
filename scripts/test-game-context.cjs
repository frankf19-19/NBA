const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),C=require('./game-context'),M=require('./margin-model');
assert(C.classify({id:'401607494'},{neutralSite:false}).neutralSite,'Known 2023 neutral semifinal corrects false feed flag');
assert(C.classify({id:'401809839'},{}).cupFinal);assert(C.classify({id:'new'},{type:{id:'39',abbreviation:'CC'}}).cupFinal);
assert(C.classify({id:'new'},{notes:[{headline:'NBA Cup Championship'}]}).cupFinal);
assert(!C.classify({id:'new'},{notes:[{headline:'NBA Cup Semifinal'}],neutralSite:false}).cupFinal);
assert(!C.classify({id:'new'},{notes:[{headline:'NBA Finals'}]}).cupFinal);
assert(!C.classify({id:'new'},{notes:[{headline:'NBA Cup Semi-Final'}]}).cupFinal);
assert(!C.classify({id:'new'},{notes:[{headline:'NBA Cup Quarter-Final'}]}).cupFinal);
assert(C.classify({id:'new'},{neutralSite:true}).neutralSite);
const base={id:'normal',d:'2025-12-16',sy:2026,hid:1,aid:2,am:3,m:2,mm:4,f:{b:1,x:Array(7).fill(0)},pg:{at:'old',mm:5}};
const cup={...base,id:'401809839'},frozen=JSON.stringify(cup);assert.equal(M.clean([cup],'2026-01-01').length,0);assert.equal(JSON.stringify(cup),frozen);assert.equal(M.clean([base],'2026-01-01').length,1);assert(C.ledgerFlags(cup).nu&&C.ledgerFlags(cup).cf);
const html=fs.readFileSync('index.html','utf8'),start=html.indexOf('function statsAsOf('),end=html.indexOf('/* 開季冷啟動',start),c=vm.createContext({daysBetween:(a,b)=>(Date.parse(b)-Date.parse(a))/864e5});vm.runInContext(html.slice(start,end),c);
// Execute the actual prediction-domain decision before any model calls.
{const start=html.indexOf('function predict('),end=html.indexOf('  const gameHca=',start),domain=vm.createContext({log5:()=>.5});vm.runInContext(html.slice(start,end)+'return distributionDate;}',domain);const g={homeId:1,awayId:2},pm={1:{gp:5},2:{gp:5}},date='2026-04-14';assert.equal(domain.predict({...g,stype:2},pm,112,date),date);for(const stype of [1,3,5])assert.equal(domain.predict({...g,stype},pm,112,date),null,'Non-regular season type '+stype+' must not use regular-only calibrated models');for(const flags of [{neutralSite:true},{cupFinal:true}])assert.equal(domain.predict({...g,stype:2,...flags},pm,112,date),null);}
const rows=[{date:'2025-12-14',done:true,pf:100,pa:90,won:true},{date:'2025-12-16',done:true,pf:80,pa:120,won:false,cupFinal:true}];const stats=c.statsAsOf(rows,'2025-12-16','2025-12-17');assert.equal(stats.gp,1);assert.equal(stats.rs,100);assert.equal(stats.w,1);assert.equal(stats.l,0);assert.equal(stats.rest,1);assert.equal(stats.g4,2,'Cup final still contributes to workload/rest');
const Q=require('./quality-model');
const g=(id,d,h,a,am,extra={})=>({id,d,sy:2027,hid:h,aid:a,am,f:{b:1,x:Array(7).fill(0)},...extra});
const all=[g('a','2026-10-20',1,2,10),g('neutral','2026-10-22',1,3,30,{nu:1}),g('b','2026-10-23',1,4,-5)],clean=M.clean(all,'2026-10-24');
const q=Q.featureRows(clean,{calendar:C.workload(all,'2026-10-24')});assert.equal(q.rows[1].x[5],1,'Actual neutral game contributes to 3-in-4 workload');assert.equal(q.state.lastDates[1].length,3);
const altered=all.map(x=>x.id==='neutral'?{...x,am:100}:x),q2=Q.featureRows(M.clean(altered,'2026-10-24'),{calendar:C.workload(altered,'2026-10-24')});assert.deepEqual(q.rows.map(r=>r.x),q2.rows.map(r=>r.x));assert.deepEqual(q.state.ratings,q2.state.ratings,'Neutral score never updates strength');
assert.equal(C.workload([...all,g('future','2026-10-25',1,5,20)],'2026-10-24').length,3);
console.log('Competition context checks passed: neutral overrides, explicit Cup final classification, semifinal retention, immutable forecasts, regular-season statistics vs actual workload.');

(async()=>{const event={id:'future-cup',date:'2026-12-16T01:00Z',season:{year:2027,type:2},competitions:[{type:{id:'39',abbreviation:'CC'},notes:[{headline:'NBA Cup Championship'}],neutralSite:false,status:{type:{state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:'18',displayName:'Home'}},{homeAway:'away',team:{id:'24',displayName:'Away'}}]}]};
const api=vm.createContext({window:{NBAGameContext:C},SB:'nba',dkey:x=>x,taipeiTime:x=>x,etDateOf:x=>String(x).slice(0,10),jget:async u=>({events:u.includes('seasontype=3')?[]:[event]})});const start=html.indexOf('async function fetchGames('),end=html.indexOf('function statsAsOf(',start);vm.runInContext(html.slice(start,end),api);const games=await api.fetchGames('2026-12-15');assert(games[0].cupFinal&&games[0].neutralSite);assert.equal(games[0].status,'Preview','Classification available before tip-off');const rows=await api.fetchTeamSeason(18,2027);assert(rows[0].cupFinal);console.log('Scoreboard/schedule parser context propagation passed.');})().catch(e=>{console.error(e);process.exitCode=1;});

{const start=html.indexOf('function predict('),end=html.indexOf('\nfunction ',start+1),c=vm.createContext({log5:()=>.5});vm.runInContext(html.slice(start,end),c);const g={homeId:1,awayId:2,home:'Home',away:'Away'};assert.equal(c.predict(g,{},null).home_prob,.56);assert.equal(c.predict({...g,neutralSite:true},{},null).home_prob,.5);assert.equal(c.predict({...g,cupFinal:true},{},null).home_prob,.5);console.log('Neutral cold-start fallback has no home bonus.');}
