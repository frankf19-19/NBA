import json,collections,math,argparse,numpy as np
parser=argparse.ArgumentParser();parser.add_argument('--features',default='features.json');parser.add_argument('--prefix',default='availability');args=parser.parse_args()
from pathlib import Path
R=Path(__file__).resolve().parent;rows=json.loads((R/args.features).read_text(encoding='utf-8'))['rows'];sy=np.array([e['sy'] for e in rows]);base=np.array([e['base'] for e in rows]);y=np.array([e['y'] for e in rows]);dates=np.array([e['d'] for e in rows]);fixed={'Out':1.,'Doubtful':.75,'Questionable':.4,'Probable':.1,'Available':0.};names=['fixed','status','statusAge','statusRole'];P=np.full((len(rows),4),np.nan);records=[]
def age(e):return 0 if e['ageHours']<=1 else 1 if e['ageHours']<=3 else 2
def eligible(p):return p['ppg']>=6 and p['mpg']>=10
for i,e in enumerate(rows):
 if e['boxKnown']:
  for p,appear in zip(e['players'],e['appearanceLabels']):
   if eligible(p):records.append(dict(i=i,sy=e['sy'],s=p['status'],age=age(e),role=int(p['ppg']>=15),out=1-appear))
def point(i,weights):
 loss=np.zeros(2)
 for j,p in enumerate(rows[i]['players']):
  if p['ppg']>=6:loss[p['side']]+=.06*p['ppg']*weights[j]
 return base[i]+np.clip(loss[1],0,7)-np.clip(loss[0],0,7)
def met(mask,p):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(np.mean((t>0)==(v>=0))))
folds=[];playerEval=[[] for _ in names]
for season in [2024,2025,2026]:
 tr=[r for r in records if r['sy']<season];glob={};counts={}
 for s in fixed:
  a=[r['out'] for r in tr if r['s']==s];glob[s]=(sum(a)+50*fixed[s])/(len(a)+50);counts[s]=dict(n=len(a),out=sum(a),weight=glob[s])
 tables=[]
 for field in ['age','role']:
  tab={}
  for s in fixed:
   for v in range(3 if field=='age' else 2):
    a=[r['out'] for r in tr if r['s']==s and r[field]==v];tab[s,v]=(sum(a)+100*glob[s])/(len(a)+100)
  tables.append(tab)
 def weights(p,e):
  s=p['status']
  if not eligible(p):return [fixed[s]]*4
  return [fixed[s],glob[s],tables[0][s,age(e)],tables[1][s,int(p['ppg']>=15)]]
 te=(sy==season)&np.array([e['boxKnown'] for e in rows])
 for i in np.where(te)[0]:
  allw=[weights(p,rows[i]) for p in rows[i]['players']]
  for k in range(4):P[i,k]=point(i,[w[k] for w in allw])
 for rec in records:
  if rec['sy']!=season:continue
  e=rows[rec['i']];pred=[fixed[rec['s']],glob[rec['s']],tables[0][rec['s'],rec['age']],tables[1][rec['s'],rec['role']]]
  for k in range(4):playerEval[k].append((rec['out'],pred[k]))
 folds.append(dict(season=season,trainingStatus=counts,models={name:met(te,P[:,k]) for k,name in enumerate(names)}))
mask=(sy>=2024)&np.isfinite(P).all(1);ds=sorted(set(dates[mask]));ns=np.array([sum((dates==d)&mask) for d in ds]);ix=np.random.default_rng(20261027).integers(0,len(ds),(5000,len(ds)));cis={}
for k in range(1,4):
 delta=abs(y-P[:,k])-abs(y-P[:,0]);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);cis[names[k]]=dict(mean=float(delta[mask].mean()),CI95=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist())
status={}
for s in fixed:
 a=[r['out'] for r in records if r['sy']>=2024 and r['s']==s];status[s]=dict(n=len(a),noAppearance=float(np.mean(a)) if a else None,fixed=fixed[s])
prop={}
for k,n in enumerate(names):
 a=np.array(playerEval[k]);t=a[:,0];p=np.clip(a[:,1],1e-6,1-1e-6);prop[n]=dict(n=len(a),brier=float(np.mean((t-p)**2)),logloss=float(np.mean(-t*np.log(p)-(1-t)*np.log(1-p))))
r=dict(folds=folds,gameMetrics={name:met(mask,P[:,k]) for k,name in enumerate(names)},playerMetrics=prop,observedStatusDescriptive=status,pairedGameDifference=cis);(R/(args.prefix+'-results.json')).write_text(json.dumps(r,indent=2));np.save(R/(args.prefix+'-predictions.npy'),P);print(json.dumps({k:v for k,v in r.items() if k!='folds'},indent=2));print('WEIGHTS',[(f['season'],{s:round(v['weight'],4) for s,v in f['trainingStatus'].items()}) for f in folds])
