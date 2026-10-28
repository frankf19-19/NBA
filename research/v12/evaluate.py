import os,sys,json
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent));import numpy as np
from analyze import cls,empirical_probs,metrics
NAMES=['kernel','priorControl','pace','expectedTotal','threeVolume','paceTotal','halfPaceTotal']
def base_probs(tp,ty,v):
 grid=empirical_probs(tp,ty,np.arange(161)*.25,'kernel',2,100);grid[0,:6]=grid[0,6:]=(grid[0,:6]+grid[0,6:])/2;a=np.minimum(160,abs(v)/.25);lo=a.astype(int);hi=np.minimum(160,lo+1);q=grid[lo]*(1-a+lo)[:,None]+grid[hi]*(a-lo)[:,None];q[v<0]=np.c_[q[v<0,6:],q[v<0,:6]];return q/q.sum(1)[:,None]
def conditional(tp,ty,tf,v,vf,base):
 c=cls(ty*np.where(tp>=0,1,-1));one=np.eye(12)[c];out=np.empty((len(v),5,12));context=[[],[0],[1],[2],[0,1]]
 for start in range(0,len(v),200):
  stop=min(start+200,len(v));vv=v[start:stop];mu=np.minimum(40,abs(vv));w=np.exp(-.5*((mu[:,None]-abs(tp)[None,:])/2)**2);b=base[start:stop].copy();b[vv<0]=np.c_[b[vv<0,6:],b[vv<0,:6]]
  for k,cols in enumerate(context):
   wk=w.copy()
   if cols:wk*=np.exp(-.5*np.sum((vf[start:stop,None,cols]-tf[None,:,cols])**2,axis=2))
   counts=wk@one;prob=(counts+100*b)/(wk.sum(1)[:,None]+100)
   zero=mu==0
   if zero.any():prob[zero,:6]=prob[zero,6:]=(prob[zero,:6]+prob[zero,6:])/2
   prob[vv<0]=np.c_[prob[vv<0,6:],prob[vv<0,:6]];out[start:stop,k]=prob/prob.sum(1)[:,None]
 return out
if __name__=='__main__':
 z=np.load(R.parent/'v7/clean-reference.npz');s=z['sy'];y=z['y'];p=z['base'];dates=z['dates'];F=np.load(R/'features.npz')['X'];ok=np.isfinite(p);Q=np.full((len(y),7,12),np.nan)
 for season in range(2012,2027):
  tr=(s>=season-3)&(s<season)&ok;te=(s==season)&ok
  if tr.sum()<2000:continue
  b=base_probs(p[tr],y[tr],p[te]);Q[te,0]=b;Q[te,1:6]=conditional(p[tr],y[tr],F[tr],p[te],F[te],b);Q[te,6]=.5*(b+Q[te,5]);assert np.isfinite(Q[te]).all() and (Q[te]>=0).all() and np.max(abs(Q[te].sum(2)-1))<1e-10
  print(season,{n:round(metrics(y[te],p[te],Q[te,k])['logloss'],6) for k,n in enumerate(NAMES)},flush=True)
 np.save(R/'probabilities.npy',Q);selected=np.full((len(y),12),np.nan);folds=[]
 def met(mask,q):return metrics(y[mask],p[mask],q[mask])
 for season in range(2015,2027):
  val=(s>=season-3)&(s<season)&np.isfinite(Q).all((1,2));te=(s==season)&np.isfinite(Q).all((1,2));ms=[met(val,Q[:,k]) for k in range(7)];b=ms[0];eligible=[k for k in range(1,7) if ms[k]['logloss']<=b['logloss']-.002 and ms[k]['brier']<=b['brier'] and ms[k]['full']>=b['full']];best=min((ms[k]['logloss'] for k in eligible),default=0);choice=next((k for k in eligible if ms[k]['logloss']<=best+.001),0);selected[te]=Q[te,choice];folds.append(dict(season=season,choice=NAMES[choice],baseline=met(te,Q[:,0]),selected=met(te,selected),all={n:met(te,Q[:,k]) for k,n in enumerate(NAMES)}))
 mask=(s>=2021)&np.isfinite(selected).all(1);ds=sorted(set(dates[mask]));label=cls(y);baseLoss=-np.log(np.maximum(Q[np.arange(len(y)),0,label],1e-8));selLoss=-np.log(np.maximum(selected[np.arange(len(y)),label],1e-8));delta=selLoss-baseLoss;sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([((dates==d)&mask).sum() for d in ds]);ix=np.random.default_rng(20261028).integers(0,len(ds),(3000,len(ds)));ci=np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist();b=met(mask,Q[:,0]);a=met(mask,selected);improved=sum(f['selected']['logloss']<f['baseline']['logloss'] for f in folds if f['season']>=2021)
 out=dict(names=NAMES,scope='Repeated retrospective conditional empirical probability study; fixed clean regress3 point margins; no injury or market inputs',folds=folds,recent=dict(baseline=b,selected=a,all={n:met(mask,Q[:,k]) for k,n in enumerate(NAMES)},loglossDifferenceCI95=ci,improvedYears=improved),gate=bool(a['logloss']<b['logloss'] and a['brier']<=b['brier'] and a['full']>=b['full'] and improved>=4 and ci[1]<0));(R/'results.json').write_text(json.dumps(out,indent=2));np.save(R/'selected.npy',selected);print('RESULT',json.dumps(out['recent']),flush=True);print('GATE',out['gate'])
