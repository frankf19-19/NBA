import os,sys,json
from pathlib import Path
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent/'pydeps'))
import numpy as np
from scipy.optimize import minimize
z=np.load(R/'features.npz');sy=z['sy'];y=z['y'];dates=z['dates'];P=np.load(R/'predictions.npy');base=P[:,0];Q=np.full((len(y),3),np.nan);Q[:,0]=P[:,1:].mean(1);Q[:,1]=(base+Q[:,0])/2;folds=[]
def met(mask,p):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(np.mean((t>0)==(v>=0))))
for season in range(2015,2027):
 tr=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);D=P[tr,1:]-base[tr,None];t=y[tr]-base[tr];G=(D.T@D+np.eye(6)*100)/len(t);b=D.T@t/len(t)
 opt=minimize(lambda w:float(w@G@w-2*w@b),np.zeros(6),jac=lambda w:2*(G@w-b),bounds=[(0,1)]*6,constraints=[dict(type='ineq',fun=lambda w:1-w.sum(),jac=lambda w:-np.ones(6))],method='SLSQP',options={'maxiter':1000,'ftol':1e-8})
 if not opt.success:raise RuntimeError(opt.message)
 Q[te,2]=base[te]+(P[te,1:]-base[te,None])@opt.x;folds.append(dict(season=season,weights=[float(1-opt.x.sum()),*opt.x.tolist()],baseline=met(te,base),models=[met(te,Q[:,k]) for k in range(3)]))
mask=(sy>=2021)&np.isfinite(Q).all(1);ds=sorted(set(dates[mask]));ns=np.array([sum((dates==d)&mask) for d in ds]);rng=np.random.default_rng(20261027);ix=rng.integers(0,len(ds),(3000,len(ds)));cis=[]
for k in range(3):
 delta=abs(y-Q[:,k])-abs(y-base);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);cis.append(np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist())
r=dict(names=['uniform6','halfCurrentUniform','pastOnlyConstrained'],folds=folds,recent=dict(baseline=met(mask,base),models=[met(mask,Q[:,k]) for k in range(3)],ci=cis));(R/'ensemble-results.json').write_text(json.dumps(r,indent=2));np.save(R/'ensemble-predictions.npy',Q);print(json.dumps(r['recent'],indent=2));print('ANNUAL',[(f['season'],[round(m['mae']-f['baseline']['mae'],4) for m in f['models']]) for f in folds])
