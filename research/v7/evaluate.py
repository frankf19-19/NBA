import json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent;z=np.load(R.parent/'v2/features.npz');B=z['X'][:,[0,2,3,4,5,14,15,16]];sy=z['sy'];y=z['y'];dates=z['dates'];f=np.load(R/'features.npz');F=f['X'];valid=f['valid'];meta=json.loads((R.parent/'v2/meta.json').read_text());T=np.zeros((len(y),30));T[np.arange(len(y)),[e['hid']-1 for e in meta]]=valid.astype(float)
names=['current','scheduleDensity','travel','altitude','all','allTeamHome'];groups=[[0,1,2,3,4,5,6,7,13],[8,9,10,11,12,13,14,20],[15,16,17,18,19],list(range(21))];mats=[None,*[np.c_[B,F[:,cols]] for cols in groups],np.c_[B,F,T]];base=np.load(R.parent/'v2/predictions.npy')[:,2];P=np.tile(base[:,None],(1,6))
def fit(x,t):
 s=x.std(0);s[s<1e-6]=1;A=x/s;pen=np.diag([1e-8]+[10]*7+[100]*(x.shape[1]-8));return np.linalg.solve(A.T@A+pen,A.T@t)/s
for season in range(2005,2027):
 tr=(sy>=season-4)&(sy<season);te=(sy==season)&valid
 for k in range(1,6):P[te,k]=mats[k][te]@fit(mats[k][tr],y[tr])
 print(season,flush=True)
np.save(R/'predictions.npy',P)
def met(mask,p):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(np.mean((t>0)==(v>=0))))
selected=np.full(len(y),np.nan);folds=[]
for season in range(2015,2027):
 val=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);ms=[met(val,P[:,k]) for k in range(6)];b=ms[0];ok=[k for k in range(1,6) if ms[k]['mae']<=b['mae']-.03 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min((ms[k]['mae'] for k in ok),default=0);choice=next((k for k in ok if ms[k]['mae']<=best+.01),0);selected[te]=P[te,choice];folds.append(dict(season=season,choice=names[choice],baseline=met(te,base),selected=met(te,selected),eligible=int((te&valid).sum()),all={names[k]:met(te,P[:,k]) for k in range(6)}))
mask=(sy>=2021)&np.isfinite(selected);ds=sorted(set(dates[mask]));delta=abs(y-selected)-abs(y-base);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([sum((dates==d)&mask) for d in ds]);ix=np.random.default_rng(20261027).integers(0,len(ds),(3000,len(ds)));ci=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist();r=dict(names=names,folds=folds,recent=dict(baseline=met(mask,base),selected=met(mask,selected),all={names[k]:met(mask,P[:,k]) for k in range(6)},eligible=int((mask&valid).sum()),ci=ci));(R/'results.json').write_text(json.dumps(r,indent=2));np.save(R/'selected.npy',selected);print('RESULT',json.dumps(r['recent']),flush=True);print('CHOICES',[(f['season'],f['choice']) for f in folds])
