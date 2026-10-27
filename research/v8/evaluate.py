import json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent;a=json.loads((R/'features.json').read_text(encoding='utf-8'));rows=a['rows'];sy=np.array([e['sy'] for e in rows]);y=np.array([e['y'] for e in rows]);base=np.array([e['base'] for e in rows]);dates=np.array([e['d'] for e in rows]);X=np.array([e['x'] for e in rows]);L=X[:,:,0]*.06;I=X[:,:,1];J=X[:,:,2];names=['currentRule','relearnPPG','playerImpact','combined','incrementalPlayerImpact'];P=np.full((len(y),5),np.nan)
def correction(team):return np.clip(team[:,1],-7,7)-np.clip(team[:,0],-7,7)
P[:,0]=base+correction(L)
def met(mask,p):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(np.mean((t>0)==(v>=0))))
folds=[]
for season in [2024,2025,2026]:
 tr=sy<season;te=sy==season;target=y[tr]-base[tr];gains=[]
 for k,team in [(1,L),(2,I),(4,J)]:
  grid=np.arange(301)/100;loss=[np.mean((target-correction(g*team[tr]))**2) for g in grid];gain=float(grid[np.argmin(loss)]);gains.append(dict(name=names[k],gain=gain));P[te,k]=base[te]+correction(gain*team[te])
 D=np.c_[L[:,1]-L[:,0],I[:,1]-I[:,0]];scale=D[tr].std(0);scale[scale<1e-6]=1;A=D[tr]/scale;prior=np.array([1.,0.])*scale;c=np.linalg.solve(A.T@A+np.eye(2)*100,A.T@target+100*prior)/scale
 P[te,3]=base[te]+correction(c[0]*L[te]+c[1]*I[te]);folds.append(dict(season=season,trainN=int(tr.sum()),gains=gains,combinedCoefficients=c.tolist(),models={name:met(te,P[:,k]) for k,name in enumerate(names)}))
mask=(sy>=2024)&np.isfinite(P).all(1);ds=sorted(set(dates[mask]));ns=np.array([sum((dates==d)&mask) for d in ds]);rng=np.random.default_rng(20261027);ix=rng.integers(0,len(ds),(5000,len(ds)));cis={}
for k in range(1,5):
 delta=abs(y-P[:,k])-abs(y-P[:,0]);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ci=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist();cis[names[k]]=dict(maeDifference=float(delta[mask].mean()),CI95=ci,improvedSeasons=sum(f['models'][names[k]]['mae']<f['models']['currentRule']['mae'] for f in folds))
r=dict(names=names,audit=a['audit'],folds=folds,test={name:met(mask,P[:,k]) for k,name in enumerate(names)},noInjuryDescriptive=met(mask,base),pairedComparisons=cis,reportAgeHours=np.quantile([e['ageHours'] for e in rows],[0,.5,1]).tolist());(R/'results.json').write_text(json.dumps(r,indent=2));np.save(R/'predictions.npy',P);print(json.dumps(r,indent=2))
