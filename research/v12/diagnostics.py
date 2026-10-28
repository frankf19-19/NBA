import json,numpy as np
from pathlib import Path
R=Path('research/v12');z=np.load('research/v7/clean-reference.npz');F=np.load(R/'features.npz')['X'];Q=np.load(R/'probabilities.npy');s=z['sy'];p=z['base'];y=z['y'];d=z['dates'];m=(s>=2021)&np.isfinite(Q).all((1,2));c=(np.minimum((abs(y).astype(int)-1)//5,5)+(y<0)*6).astype(int);loss=-np.log(np.maximum(Q[np.arange(len(y)),:,c],1e-8));days=sorted(set(d[m]));ns=np.array([((d==v)&m).sum() for v in days]);ix=np.random.default_rng(20261028).integers(0,len(days),(3000,len(days)))
def pair(k,j):
 delta=loss[:,k]-loss[:,j];sums=np.array([delta[(d==v)&m].sum() for v in days]);return dict(difference=float(delta[m].mean()),pairedDateCI95=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist())
cohorts=[]
for name,a in [('belowPriorPace',F[:,0]<-.2),('nearPriorPace',abs(F[:,0])<=.2),('abovePriorPace',F[:,0]>.2)]:
 t=m&a;cohorts.append(dict(name=name,n=int(t.sum()),pointRMSE=float(np.sqrt(((y[t]-p[t])**2).mean())),meanAbsolutePredictedMargin=float(abs(p[t]).mean())))
out=dict(scope='Descriptive diagnostics only; no extra model fitting or selection',paceTotalVersusKernel=pair(5,0),paceTotalVersusPriorControl=pair(5,1),cohorts=cohorts);(R/'diagnostics.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
