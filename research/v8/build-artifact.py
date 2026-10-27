import json,collections
from pathlib import Path
R=Path('research/v8');a=json.loads((R/'features.json').read_text(encoding='utf-8'))['rows'];fixed={'Out':1.,'Doubtful':.75,'Questionable':.4,'Probable':.1,'Available':0.};records=[]
for e in a:
 if not e['boxKnown'] or e['sy']>=2027:continue
 for p,label in zip(e['players'],e['appearanceLabels']):
  if p['ppg']>=6 and p['mpg']>=10:records.append(dict(status=p['status'],role=int(p['ppg']>=15),age=0 if e['ageHours']<=1 else 1 if e['ageHours']<=3 else 2,out=1-label))
glob={};table={};ageTable={}
for status,prior in fixed.items():
 pool=[e['out'] for e in records if e['status']==status];prob=(sum(pool)+50*prior)/(len(pool)+50);glob[status]=dict(n=len(pool),out=sum(pool),probability=prob)
 for role in [0,1]:
  v=[e['out'] for e in records if e['status']==status and e['role']==role];table[status+'|'+str(role)]=dict(n=len(v),out=sum(v),probability=(sum(v)+100*prob)/(len(v)+100))
for status in fixed:
 for age in [0,1,2]:
  v=[e['out'] for e in records if e['status']==status and e['age']==age];ageTable[status+'|'+str(age)]=dict(n=len(v),out=sum(v),probability=(sum(v)+100*glob[status]['probability'])/(len(v)+100))
r=dict(schema=1,version='availability-shadow-v1',mode='shadow',pointEnabled=False,season=2027,trainedThrough=max(e['d'] for e in a),trainingSeasons=[2021,2026],method='statusBeta50',alternatives=['statusAge','statusRole'],outcome='no recorded appearance; includes coaching decisions, not injury diagnosis',config=dict(minReportAgeHours=.5,maxReportAgeHours=6,minPPG=6,minMPG=10,rolePPG=15,currentMinGames=5,previousMinGames=8,minTipETMinutes=1050,maxTipETMinutes=1380),status=glob,table=table,ageTable=ageTable,validation=json.loads((R/'availability-results.json').read_text()),prospective=dict(n=0,automaticPromotion=False));Path('availability-shadow.json').write_text(json.dumps(r),encoding='utf-8');print('Availability research artifact',len(records),r['trainedThrough'])
