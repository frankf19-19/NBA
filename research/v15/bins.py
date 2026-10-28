import os,sys,json
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent));import numpy as np
from analyze import empirical_probs,metrics
z=np.load(R.parent/'v7/clean-reference.npz');s=z['sy'];y=z['y'];P=np.load(R/'predictions.npy');policy=np.load(R/'selected.npy');P=np.c_[P,policy];names=json.loads((R/'results.json').read_text())['names']+['pastOnlySelection'];Q=np.full((len(y),len(names),12),np.nan);folds=[]
for season in range(2021,2027):
 tr=(s>=season-3)&(s<season)&np.isfinite(P).all(1);te=(s==season)&np.isfinite(P).all(1);annual={}
 for k,name in enumerate(names):
  grid=empirical_probs(P[tr,k],y[tr],np.arange(161)*.25,'kernel',2,100);grid[0,:6]=grid[0,6:]=(grid[0,:6]+grid[0,6:])/2;v=P[te,k];a=np.minimum(160,abs(v)/.25);lo=a.astype(int);hi=np.minimum(160,lo+1);q=grid[lo]*(1-a+lo)[:,None]+grid[hi]*(a-lo)[:,None];q[v<0]=np.c_[q[v<0,6:],q[v<0,:6]];Q[te,k]=q/q.sum(1)[:,None];annual[name]=metrics(y[te],v,Q[te,k])
 folds.append(dict(season=season,all=annual))
mask=(s>=2021)&np.isfinite(Q).all((1,2));recent={n:metrics(y[mask],P[mask,k],Q[mask,k]) for k,n in enumerate(names)};b=recent[names[0]];a=recent['pastOnlySelection'];pointGate=json.loads((R/'results.json').read_text())['pointGate'];out=dict(scope='Past3 OOF season empirical kernel per candidate; repeated retrospective research, not a live website reconstruction',folds=folds,recent=recent,combinedGate=bool(pointGate and a['logloss']<=b['logloss'] and a['brier']<=b['brier'] and a['full']>=b['full']));(R/'bin-results.json').write_text(json.dumps(out,indent=2));np.save(R/'probabilities.npy',Q);print(json.dumps(recent,indent=2));print('COMBINED_GATE',out['combinedGate'])
