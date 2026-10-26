'use strict';
// NBA report filenames can differ from the publication time printed inside.
const et=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function publication(text){
 const m=/Injury\s*Report:\s*(\d{2})\/(\d{2})\/(\d{2}|\d{4})\s*(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(String(text));
 if(!m)return null;
 const year=+m[3]+(m[3].length===2?2000:0),month=+m[1],day=+m[2],h=+m[4],minute=+m[5];
 if(h<1||h>12||minute>59||month<1||month>12||day<1||day>31)return null;
 const hour=h%12+(m[6].toUpperCase()==='PM'?12:0),wall=Date.UTC(year,month-1,day,hour,minute);
 const matches=[];
 for(const offset of [4,5]){
  const ms=wall+offset*3600000,p=Object.fromEntries(et.formatToParts(ms).map(x=>[x.type,x.value]));
  if(+p.year===year&&+p.month===month&&+p.day===day&&+p.hour===hour&&+p.minute===minute)matches.push(ms);
 }
 // Reject ambiguous DST times instead of guessing.
 return matches.length===1?new Date(matches[0]).toISOString():null;
}
function usable(record,now=Date.now()){
 return !!record&&record.pv===3&&Array.isArray(record.rows)&&Number.isFinite(Date.parse(record.publishedAt))&&Date.parse(record.publishedAt)<=now;
}
module.exports={publication,usable};
