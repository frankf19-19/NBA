import os,sys,json
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent/'pydeps'))
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
z=np.load(R.parent/'v2/features.npz');old=z['X'];sy=z['sy'];y=z['y'];dates=z['dates'];B=old[:,[0,2,3,4,5,14,15,16]];F=np.load(R/'matchup.npy');extra=old[:,14:17]*((F[:,24]-100)/100)[:,None];mats=[None,np.c_[B,F[:,:16]],np.c_[B,F[:,16:24]],np.c_[B,F[:,:24]],np.c_[B,F[:,:24],extra],np.c_[B,F,extra]];names=['current','additiveStyles','matchupProducts','both','paceInteractions','boostAbsolute'];base=np.load(R.parent/'v2/predictions.npy')[:,2];P=np.full((len(y),6),np.nan);P[:,0]=base
ids=json.loads((R/'ids.json').read_text());meta=json.loads((R.parent/'v2/meta.json').read_text());assert ids==[e['id'] for e in meta]
def fit(x,t):
 s=x.std(0);s[s<1e-6]=1;A=x/s;pen=np.diag([1e-8]+[10]*7+[100]*(x.shape[1]-8));return np.linalg.solve(A.T@A+pen,A.T@t)/s
for season in range(2005,2027):
 tr=(sy>=season-4)&(sy<season);te=sy==season
 for k in range(1,5):P[te,k]=mats[k][te]@fit(mats[k][tr],y[tr])
 m=HistGradientBoostingRegressor(loss='absolute_error',max_iter=150,max_leaf_nodes=7,max_depth=3,learning_rate=.05,min_samples_leaf=100,l2_regularization=50,early_stopping=False,random_state=20261027);m.fit(mats[5][tr],y[tr]);P[te,5]=m.predict(mats[5][te]);print(season,flush=True)
np.save(R/'predictions.npy',P)
def met(mask,p):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(np.mean((t>0)==(v>=0))))
selected=np.full(len(y),np.nan);folds=[]
for season in range(2015,2027):
 val=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);ms=[met(val,P[:,k]) for k in range(6)];b=ms[0];ok=[k for k in range(1,6) if ms[k]['mae']<=b['mae']-.03 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min((ms[k]['mae'] for k in ok),default=0);choice=next((k for k in ok if ms[k]['mae']<=best+.01),0);selected[te]=P[te,choice];folds.append(dict(season=season,choice=names[choice],baseline=met(te,base),selected=met(te,selected),all={names[k]:met(te,P[:,k]) for k in range(6)}))
mask=(sy>=2021)&np.isfinite(selected);ds=sorted(set(dates[mask]));delta=abs(y-selected)-abs(y-base);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([sum((dates==d)&mask) for d in ds]);ix=np.random.default_rng(20261027).integers(0,len(ds),(3000,len(ds)));ci=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist();r=dict(names=names,folds=folds,recent=dict(baseline=met(mask,base),selected=met(mask,selected),all={names[k]:met(mask,P[:,k]) for k in range(6)},ci=ci));(R/'results.json').write_text(json.dumps(r,indent=2));np.save(R/'selected.npy',selected);print('RESULT',json.dumps(r['recent']),flush=True);print('CHOICES',[(f['season'],f['choice']) for f in folds])
