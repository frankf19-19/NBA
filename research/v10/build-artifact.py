import os,sys,json
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent/'pydeps'));sys.path.insert(0,str(R.parent))
import numpy as np
from sklearn.linear_model import LogisticRegression
from analyze import cls
z=np.load(R.parent/'v7/clean-reference.npz');sy=z['sy'];p=z['base'];y=z['y'];d=z['dates'];tr=(sy>=2024)&(sy<2027)&np.isfinite(p)
def poly(v):
 a=np.clip(v,-40,40)/10;return np.c_[a,a*a,a*a*a]
def fit(x,t):return LogisticRegression(C=1,solver='lbfgs',max_iter=500,tol=1e-8).fit(x,t)
tp=p[tr];ty=y[tr];xx=np.r_[tp,-tp];yy=np.r_[ty,-ty];win=fit(poly(xx),(yy>0).astype(int));mag=fit(poly(tp*np.sign(ty)),cls(abs(ty)))
v=np.arange(161)*.25;w=win.predict_proba(poly(v))[:,1];grid=np.c_[mag.predict_proba(poly(v))*w[:,None],mag.predict_proba(poly(-v))*(1-w)[:,None]];grid[0,:6]=grid[0,6:]=(grid[0,:6]+grid[0,6:])/2
artifact=dict(schema=1,version='bin-factor-shadow-v1',mode='shadow',pointEnabled=False,automaticPromotion=False,season=2027,trainedThrough=str(max(d[tr])),trainSeasons=[2024,2025,2026],trainN=int(tr.sum()),method='halfFactorized',weight=.5,grid=dict(step=.25,probabilities=grid.tolist()),scope='Blend simultaneous formal probabilities with winner/magnitude factorization; point margin unchanged; not enabled for public predictions',selection='Best aggregate historical log loss among the predeclared round10 candidates; did not pass promotion gate',training='Past three completed seasons of fixed regress3 out-of-fold margins; no 2027 outcomes')
artifact['prospective']=dict(n=0,dates=0,baseline=None,shadow=None,automaticPromotion=False)
Path('bin-shadow.json').write_text(json.dumps(artifact,separators=(',',':')));print('artifact',artifact['trainN'],artifact['trainedThrough'])
# Paired-date uncertainty for the chosen research candidate, not a second selection step.
q=np.load(R/'probabilities.npy');mask=(sy>=2021)&np.isfinite(q).all((1,2));c=cls(y);loss=-np.log(np.maximum(q[np.arange(len(y)),4,c],1e-8))+np.log(np.maximum(q[np.arange(len(y)),0,c],1e-8));ds=sorted(set(d[mask]));s=np.array([loss[(d==v)&mask].sum() for v in ds]);n=np.array([((d==v)&mask).sum() for v in ds]);ix=np.random.default_rng(20261028).integers(0,len(ds),(3000,len(ds)));out=dict(candidate='halfFactorized',n=int(mask.sum()),dates=len(ds),loglossDifference=float(loss[mask].mean()),pairedDateCI95=np.quantile(s[ix].sum(1)/n[ix].sum(1),[.025,.975]).tolist());(R/'candidate-uncertainty.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))

# Independent direct sklearn probabilities at grid nodes for JavaScript parity.
fixtures=[]
for value in [-55,-40,-20,-.25,0,.25,3.25,15,40,55]:
 val=np.array([np.clip(value,-40,40)]);w=win.predict_proba(poly(val))[:,1];a=np.c_[mag.predict_proba(poly(val))*w[:,None],mag.predict_proba(poly(-val))*(1-w)[:,None]][0]
 if value==0:a[:6]=a[6:]=(a[:6]+a[6:])/2
 base=np.arange(1,13,dtype=float);base/=base.sum();expected=(base+a)/2;fixtures.append(dict(margin=value,baseline=base.tolist(),expected=expected.tolist()))
(R/'parity.json').write_text(json.dumps(fixtures))
