'use strict';
/* 判斷現在是否該做「臨場重算」:有比賽將在 100 分鐘內開打,且其賽前預測已超過 40 分鐘沒更新,
   或官方傷兵報告比該預測更新。輸出 1(要重算)或 0。只更新尚未開打的比賽,已凍結的預測不會被改寫(calib.js 本身只處理未開打場次)。 */
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const rd=f=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));}catch(e){return null;}};
const now=Date.now(),sy=(()=>{const d=new Date(now-5*3600e3);return d.getUTCMonth()>=7?d.getUTCFullYear()+1:d.getUTCFullYear();})();
const PRE=rd(`seed/pregame-${sy}.json`)||{},inj=rd('injury-latest.json'),injAt=inj&&Date.parse(inj.publishedAt)||0;
const soon=Object.values(PRE).filter(p=>p&&p.tip&&p.at&&Date.parse(p.tip)>now+3*60e3&&Date.parse(p.tip)<=now+100*60e3);
const stale=soon.filter(p=>now-Date.parse(p.at)>40*60e3||injAt>Date.parse(p.at));
console.error(`100 分鐘內開打 ${soon.length} 場,需重算 ${stale.length} 場`);
process.stdout.write(stale.length?'1':'0');
