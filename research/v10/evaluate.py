import os,sys,json
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent/'pydeps'));sys.path.insert(0,str(R.parent))
import numpy as np
from sklearn.linear_model import LogisticRegression
from analyze import cls,empirical_probs,metrics
z=np.load(R.parent/'v7/clean-reference.npz');s=z['sy'];y=z['y'];p=z['base'];dates=z['dates'];ok=np.isfinite(p)
N=['kernel','mirrorCubic','ordinal','factorized','halfFactorized','halfOrdinal'];Q=np.full((len(y),len(N),12),np.nan)
def poly(v):
 a=np.clip(v,-40,40)/10
 return np.c_[a,a*a,a*a*a]
def fit(x,t):return LogisticRegression(C=1,solver='lbfgs',max_iter=500,tol=1e-8).fit(x,t)
def gridlookup(grid,v):
 a=np.minimum(160,abs(v)/.25);lo=a.astype(int);hi=np.minimum(160,lo+1);q=grid[lo]*(1-a+lo)[:,None]+grid[hi]*(a-lo)[:,None];neg=v<0;q[neg]=np.c_[q[neg,6:],q[neg,:6]];return q/q.sum(1)[:,None]
def ordinal(tp,ty,v):
 # Ordered class: away 26+,21-25,...,1-5,home 1-5,...,26+.
 c=cls(ty);ordered=np.where(c<6,c+6,11-c)
 scores=np.column_stack([fit(poly(tp),(ordered<=k).astype(int)).predict_proba(poly(v))[:,1] for k in range(11)])
 scores=np.sort(scores,axis=1)
 a=np.diff(np.c_[np.zeros(len(v)),scores,np.ones(len(v))],axis=1)
 return np.c_[a[:,6:],a[:,:6][:,::-1]]
for season in range(2012,2027):
 tr=(s>=season-3)&(s<season)&ok;te=(s==season)&ok
 if tr.sum()<2000:continue
 tp=p[tr];ty=y[tr];v=p[te];xx=np.r_[tp,-tp];yy=np.r_[ty,-ty]
 grid=empirical_probs(tp,ty,np.arange(161)*.25,'kernel',2,100);grid[0,:6]=grid[0,6:]=(grid[0,:6]+grid[0,6:])/2
 Q[te,0]=gridlookup(grid,v)
 Q[te,1]=fit(poly(xx),cls(yy)).predict_proba(poly(v))
 Q[te,2]=ordinal(xx,yy,v)
 win=fit(poly(xx),(yy>0).astype(int)).predict_proba(poly(v))[:,1]
 magnitude=fit(poly(tp*np.sign(ty)),cls(abs(ty)))
 Q[te,3]=np.c_[magnitude.predict_proba(poly(v))*win[:,None],magnitude.predict_proba(poly(-v))*(1-win)[:,None]]
 Q[te,4]=.5*(Q[te,0]+Q[te,3]);Q[te,5]=.5*(Q[te,0]+Q[te,2])
 assert np.isfinite(Q[te]).all() and (Q[te]>=-1e-12).all() and np.max(abs(Q[te].sum(2)-1))<1e-10
 print(season,{n:round(metrics(y[te],v,Q[te,k])['logloss'],6) for k,n in enumerate(N)},flush=True)
np.save(R/'probabilities.npy',Q)
def met(mask,k):return metrics(y[mask],p[mask],Q[mask,k])
folds=[];selected=np.full((len(y),12),np.nan)
for season in range(2015,2027):
 tr=(s>=season-3)&(s<season)&np.isfinite(Q).all((1,2));te=(s==season)&np.isfinite(Q).all((1,2));ms=[met(tr,k) for k in range(len(N))];b=ms[0]
 eligible=[k for k in range(1,len(N)) if ms[k]['logloss']<=b['logloss']-.002 and ms[k]['brier']<=b['brier'] and ms[k]['full']>=b['full']]
 best=min((ms[k]['logloss'] for k in eligible),default=0);choice=next((k for k in eligible if ms[k]['logloss']<=best+.001),0)
 selected[te]=Q[te,choice];folds.append(dict(season=season,choice=N[choice],baseline=met(te,0),selected=metrics(y[te],p[te],selected[te]),all={n:met(te,k) for k,n in enumerate(N)}))
mask=(s>=2021)&np.isfinite(selected).all(1);c=cls(y);loss0=-np.log(np.maximum(Q[np.arange(len(y)),0,c],1e-8));loss1=-np.log(np.maximum(selected[np.arange(len(y)),c],1e-8));ds=sorted(set(dates[mask]));sums=np.array([(loss1-loss0)[mask&(dates==d)].sum() for d in ds]);ns=np.array([(mask&(dates==d)).sum() for d in ds]);ix=np.random.default_rng(20261028).integers(0,len(ds),(3000,len(ds)));ci=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist()
recent=dict(baseline=met(mask,0),selected=metrics(y[mask],p[mask],selected[mask]),all={n:met(mask,k) for k,n in enumerate(N)},loglossDifferenceCI95=ci)
b=recent['baseline'];a=recent['selected'];years=sum(f['selected']['logloss']<f['baseline']['logloss'] for f in folds if f['season']>=2021)
result=dict(names=N,folds=folds,recent=recent,improvedYears=years,gate=bool(a['logloss']<b['logloss'] and a['brier']<=b['brier'] and a['full']>=b['full'] and years>=4 and ci[1]<0),scope='Repeated historical research, not a new blind test; point model fixed; no injury')
(R/'results.json').write_text(json.dumps(result,indent=2));np.save(R/'selected.npy',selected);print('RESULT',json.dumps(recent),flush=True);print('GATE',result['gate'],years,flush=True)
