/* Shared competition-domain metadata; no scores or prediction rewrites. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NBAGameContext=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='game-context-v1';
// Verified Las Vegas semifinals/finals, 2023-25 tournaments. Two 2023 feed flags are false.
const NEUTRAL=new Set(['401607494','401607493','401607495','401734906','401734907','401734908','401809837','401809838','401809839']);
const FINALS=new Set(['401607495','401734908','401809839']);
function classify(event={},competition={}){
 const id=String(event.id||competition.id||''),type=competition.type||{},notes=[...(competition.notes||[]),...(event.notes||[])].map(x=>typeof x==='string'?x:x.headline||'').join(' ');
 const cupFinal=FINALS.has(id)||(String(type.id)==='39'&&String(type.abbreviation).toUpperCase()==='CC')||(/(?:nba\s+cup|in[- ]season\s+tournament).*?(?:championship|\bfinals?\b)/i.test(notes)&&!/(?:semi|quarter)[ -]*finals?/i.test(notes));
 return {neutralSite:competition.neutralSite===true||NEUTRAL.has(id)||cupFinal,cupFinal};
}
function ledgerFlags(e){
 const c=classify({id:e.id},{neutralSite:!!e.nu}),cupFinal=c.cupFinal||!!e.cf;
 return {...(c.neutralSite||cupFinal?{nu:1}:{}),...(cupFinal?{cf:1}:{}),...(NEUTRAL.has(String(e.id))||cupFinal?{contextVersion:VERSION}:{})};
}
function workload(entries,cutoff){
 const seen=new Set();return entries.filter(e=>{if(!e||e.st===1||!Number.isFinite(e.am)||!e.am||!/^\d{4}-\d\d-\d\d$/.test(e.d||'')||(cutoff&&e.d>=cutoff)||![e.hid,e.aid].every(t=>Number.isInteger(t)&&t>=1&&t<=30)||e.hid===e.aid)return false;const key=e.d+'|'+e.hid+'|'+e.aid;if(seen.has(key))return false;seen.add(key);return true;}).map(e=>({d:e.d,sy:e.sy||+e.d.slice(0,4)+(+e.d.slice(5,7)>=8?1:0),hid:e.hid,aid:e.aid})).sort((a,b)=>a.d.localeCompare(b.d));
}
return {VERSION,classify,ledgerFlags,workload};
});
