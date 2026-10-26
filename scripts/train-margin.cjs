#!/usr/bin/env node
/* Offline reproducible trainer. No network and no rewrites of historical forecasts. */
const fs=require('node:fs'),path=require('node:path'),Margin=require('./margin-model');
const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback};
const dir=path.resolve(arg('--data','seed')),out=path.resolve(arg('--output','margin-model.json'));
const cutoff=arg('--cutoff',new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
if(!/^\d{4}-\d\d-\d\d$/.test(cutoff))throw new Error('Invalid cutoff date');
let entries=[];
for(const name of fs.readdirSync(dir).filter(n=>/^ledger-\d{4}\.json$/.test(n)))entries.push(...JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')));
const model=Margin.build(entries,{cutoff});if(!model)throw new Error('At least three usable OOF seasons are required');
fs.writeFileSync(out,JSON.stringify(model));
console.log(JSON.stringify({output:out,trainedThrough:model.trainedThrough,enabled:model.enabled,pointEnabled:model.pointEnabled,validation:model.validation},null,2));
