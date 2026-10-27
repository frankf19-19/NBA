import os,sys,json
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent/'pydeps'))
import numpy as np
from sklearn.linear_model import QuantileRegressor,HuberRegressor
z=np.load(R.parent/'v2/features.npz');X=z['X'][:,[0,2,3,4,5,14,15,16]];sy=z['sy'];y=z['y'];dates=z['dates'];base=np.load(R.parent/'v2/predictions.npy')[:,2];P=np.full((len(y),7),np.nan);P[:,0]=base;names=['currentRegress3','directMedian','directHuber','directStudentT','affineOLS','affineMedian','nonlinearResidual']
def ridge(x,t,penalty=10,w=None):
 s=x.std(0);s[s<1e-6]=1;A=x/s;pen=np.eye(x.shape[1])*penalty;pen[0,0]=1e-8
 if w is None:w=np.ones(len(t))
 return np.linalg.solve(A.T@(A*w[:,None])+pen,A.T@(w*t))/s
for season in range(2005,2027):
 tr=(sy>=season-4)&(sy<season);te=sy==season;scale=X[tr,1:].std(0);scale[scale<1e-6]=1;A=X[tr,1:]/scale;B=X[te,1:]/scale
 for k,model in [(1,QuantileRegressor(quantile=.5,alpha=.01,solver='highs')),(2,HuberRegressor(epsilon=1.35,alpha=10,max_iter=1000,tol=1e-8))]:model.fit(A,y[tr]);P[te,k]=model.predict(B)
 c=ridge(X[tr],y[tr])
 for _ in range(10):
  residual=y[tr]-X[tr]@c;w=6/(5+(residual/14)**2);c=ridge(X[tr],y[tr],w=w)
 P[te,3]=X[te]@c
 ca=(sy>=season-3)&(sy<season)&np.isfinite(base)
 if ca.sum()>=2000:
  Z=np.c_[np.ones(len(y)),base];P[te,4]=Z[te]@ridge(Z[ca],y[ca],penalty=10)
  s=base[ca].std();qr=QuantileRegressor(quantile=.5,alpha=.01,solver='highs').fit(base[ca,None]/s,y[ca]);P[te,5]=qr.predict(base[te,None]/s)
  Z=np.c_[np.ones(len(y)),base,np.tanh(base/10),np.tanh(base/20)];P[te,6]=base[te]+Z[te]@ridge(Z[ca],y[ca]-base[ca],penalty=100)
 print(season,flush=True)
np.save(R/'predictions.npy',P)
def met(m,p):
 t=y[m];v=p[m];return dict(n=int(m.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(((t>0)==(v>=0)).mean()))
selected=np.full(len(y),np.nan);folds=[]
for season in range(2015,2027):
 val=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);ms=[met(val,P[:,k]) for k in range(7)];b=ms[0];ok=[k for k in range(1,7) if ms[k]['mae']<=b['mae']-.03 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min([ms[k]['mae'] for k in ok],default=0);choice=next((k for k in ok if ms[k]['mae']<=best+.01),0);selected[te]=P[te,choice];folds.append(dict(season=season,choice=names[choice],baseline=met(te,base),selected=met(te,selected),all={names[k]:met(te,P[:,k]) for k in range(7)}))
mask=(sy>=2021)&np.isfinite(selected);ds=sorted(set(dates[mask]));delta=abs(y-selected)-abs(y-base);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([sum((dates==d)&mask) for d in ds]);ix=np.random.default_rng(20261027).integers(0,len(ds),(3000,len(ds)));ci=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist()
r=dict(names=names,folds=folds,recent=dict(baseline=met(mask,base),selected=met(mask,selected),all={names[k]:met(mask,P[:,k]) for k in range(7)},ci=ci));(R/'results.json').write_text(json.dumps(r,indent=2));np.save(R/'selected.npy',selected);print('RESULT',json.dumps(r['recent']),flush=True);print('CHOICES',[(f['season'],f['choice']) for f in folds])
