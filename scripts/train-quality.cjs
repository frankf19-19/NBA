const fs=require('node:fs'),path=require('node:path'),Q=require('./quality-model');
const args=process.argv.slice(2),arg=(n,d)=>{const i=args.indexOf(n);return i<0?d:args[i+1]},dir=path.resolve(arg('--data','seed')),out=path.resolve(arg('--output','quality-model.json'));
const cutoff=arg('--cutoff',new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
if(!/^\d{4}-\d\d-\d\d$/.test(cutoff))throw new Error('Invalid cutoff');let entries=[];
for(const f of fs.readdirSync(dir).filter(f=>/^ledger-\d{4}\.json$/.test(f)))entries.push(...JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
const t=Date.now(),model=Q.build(entries,{cutoff});if(!model)throw new Error('Insufficient history for nested validation');fs.writeFileSync(out,JSON.stringify(model));
console.log(JSON.stringify({enabled:model.enabled,choice:model.selection.name,through:model.trainedThrough,data:model.data,statistics:{all:model.statistics.all,recent:model.statistics.recent,maeDifferenceCI95:model.statistics.maeDifferenceCI95},seconds:(Date.now()-t)/1000},null,2));
