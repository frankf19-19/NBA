import json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent;z=np.load(R/'features.npz');X=z['X'];sy=z['sy'];y=z['y'];dates=z['dates'];base=z['base'];names=['current','cap15','smooth20','earlyFast','gapDecay90','pace100','allShotsCap20'];P=np.full((len(y),7),np.nan);P[:,0]=base

def met(mask,p):
 a=y[mask];b=p[mask];return dict(n=int(mask.sum()),mae=float(abs(a-b).mean()),rmse=float(np.sqrt(((a-b)**2).mean())),winner=float(((a>0)==(b>=0)).mean()))
def fit(x,t):
 s=x.std(0);s[s<1e-6]=1;a=x/s;pen=np.eye(x.shape[1])*10;pen[0,0]=1e-8;return np.linalg.solve(a.T@a+pen,a.T@t)/s
for season in range(2005,2027):
 tr=(sy>=season-4)&(sy<season);te=sy==season
 for k in range(6):P[te,k+1]=X[te,k]@fit(X[tr,k],y[tr])
selected=np.full(len(y),np.nan);folds=[]
for season in range(2015,2027):
 val=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);ms=[met(val,P[:,k]) for k in range(7)];b=ms[0]
 eligible=[k for k in range(1,7) if ms[k]['mae']<=b['mae']-.05 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005]
 choice=min((k for k in eligible if ms[k]['mae']<=min(ms[j]['mae'] for j in eligible)+.02),default=0)
 selected[te]=P[te,choice];folds.append(dict(season=season,choice=names[choice],baseline=met(te,base),selected=met(te,selected),all={names[k]:met(te,P[:,k]) for k in range(7)}))
mask=(sy>=2021)&np.isfinite(selected);ds=sorted(set(dates[mask]));delta=abs(y-selected)-abs(y-base);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([sum((dates==d)&mask) for d in ds]);rng=np.random.default_rng(20261027);samples=rng.integers(0,len(ds),(3000,len(ds)));ci=np.quantile(sums[samples].sum(1)/ns[samples].sum(1),[.025,.975]).tolist()
r=dict(names=names,folds=folds,recent=dict(baseline=met(mask,base),selected=met(mask,selected),all={names[k]:met(mask,P[:,k]) for k in range(7)},ci=ci),all=dict(baseline=met(np.isfinite(selected),base),selected=met(np.isfinite(selected),selected)))
(R/'results.json').write_text(json.dumps(r,indent=2));np.save(R/'predictions.npy',P);np.save(R/'selected.npy',selected);print(json.dumps({k:v for k,v in r.items() if k!='folds'},indent=2));print('CHOICES',[(f['season'],f['choice']) for f in folds])
