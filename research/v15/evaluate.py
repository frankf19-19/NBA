import json,itertools
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
NAMES=['current4','window2','window6','halfLife365','halfLife730','daily1461','halfDaily']
def fit(x,y,w=None):
 if w is None:w=np.ones(len(y))
 w=w*len(w)/w.sum();mean=(x*w[:,None]).sum(0)/w.sum();scale=np.sqrt(np.maximum(0,((x-mean)**2*w[:,None]).sum(0)/w.sum()));scale[scale<1e-6]=1;a=x/scale;pen=np.eye(x.shape[1])*10;pen[0,0]=1e-8;return np.linalg.solve(a.T@(a*w[:,None])+pen,a.T@(w*y))/scale

def prefix_predict(X,y,dates,base):
 n,k=X.shape;px=np.r_[np.zeros((1,k)),np.cumsum(X,axis=0)];pxx=np.concatenate([np.zeros((1,k,k)),np.cumsum(X[:,:,None]*X[:,None,:],axis=0)]);pxy=np.r_[np.zeros((1,k)),np.cumsum(X*y[:,None],axis=0)];days=dates.astype('datetime64[D]').astype(int);out=base.copy();audit=[]
 for d,idx in itertools.groupby(range(n),lambda i:dates[i]):
  ids=np.array(list(idx));i=ids[0];lo=int(np.searchsorted(days,days[i]-1461));count=i-lo
  if count<2000:continue
  sx=px[i]-px[lo];sxx=pxx[i]-pxx[lo];sxy=pxy[i]-pxy[lo];mean=sx/count;scale=np.sqrt(np.maximum(0,np.diag(sxx)/count-mean**2));scale[scale<1e-6]=1;A=sxx/np.outer(scale,scale);A+=np.diag([1e-8]+[10]*(k-1));co=np.linalg.solve(A,sxy/scale)/scale;out[ids]=X[ids]@co
  if len(audit)<6 and d>='2021-01-01':
   direct=fit(X[lo:i],y[lo:i]);error=float(abs(co-direct).max());assert error<1e-8,error;audit.append(dict(date=str(d),trainN=int(count),latestTrainDate=str(dates[i-1]),coefficientMaxError=error))
 return out,audit

def metrics(mask,p,y):
 a=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(a-v).mean()),rmse=float(np.sqrt(((a-v)**2).mean())),winner=float(((a>0)==(v>=0)).mean()))

def ci(mask,p,b,y,dates):
 ds=sorted(set(dates[mask]));delta=abs(y-p)-abs(y-b);ss=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([((dates==d)&mask).sum() for d in ds]);ix=np.random.default_rng(20261028).integers(0,len(ds),(3000,len(ds)));return np.quantile(ss[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist()
if __name__=='__main__':
 z=np.load(R.parent/'v7/clean-reference.npz');X=z['X'][:,[0,2,3,4,5,14,15,16]];s=z['sy'];y=z['y'];dates=z['dates'];base=z['base'];P=np.tile(base[:,None],(1,7));days=dates.astype('datetime64[D]').astype(int);parity=0
 for season in range(2005,2027):
  te=(s==season)&np.isfinite(base)
  for k,window,half in [(1,2,None),(2,6,None),(3,6,365),(4,6,730)]:
   tr=(s>=season-window)&(s<season);w=None if half is None else np.exp(-np.log(2)*(days[tr].max()-days[tr])/half);P[te,k]=X[te]@fit(X[tr],y[tr],w)
  tr=(s>=season-4)&(s<season)
  if season>=2021:parity=max(parity,float(abs(X[te]@fit(X[tr],y[tr])-base[te]).max()))
 assert parity<1e-8,parity
 P[:,5],audit=prefix_predict(X,y,dates,base);P[:,6]=.5*(P[:,0]+P[:,5]);selected=base.copy();folds=[]
 for season in range(2015,2027):
  val=(s>=season-3)&(s<season)&np.isfinite(P).all(1);te=(s==season)&np.isfinite(P).all(1);ms=[metrics(val,P[:,k],y) for k in range(7)];b=ms[0];eligible=[k for k in range(1,7) if ms[k]['mae']<=b['mae']-.03 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min((ms[k]['mae'] for k in eligible),default=0);choice=next((k for k in eligible if ms[k]['mae']<=best+.02),0);selected[te]=P[te,choice];folds.append(dict(season=season,choice=NAMES[choice],baseline=metrics(te,base,y),selected=metrics(te,selected,y),all={n:metrics(te,P[:,k],y) for k,n in enumerate(NAMES)}))
 mask=(s>=2021)&np.isfinite(P).all(1);b=metrics(mask,base,y);a=metrics(mask,selected,y);interval=ci(mask,selected,base,y,dates);improved=sum(f['selected']['mae']<f['baseline']['mae'] for f in folds if f['season']>=2021);out=dict(names=NAMES,scope='Repeated retrospective time-weighted coefficient study, fixed clean regress3 features, no injury or market inputs',baselineRebuildMaxError=parity,prefixDirectParity=audit,folds=folds,recent=dict(baseline=b,selected=a,all={n:metrics(mask,P[:,k],y) for k,n in enumerate(NAMES)},maeDifferenceCI95=interval,improvedYears=improved),pointGate=bool(a['mae']<=b['mae']-.05 and a['rmse']<=b['rmse'] and a['winner']>=b['winner'] and improved>=5 and interval[1]<0));(R/'results.json').write_text(json.dumps(out,indent=2));np.save(R/'predictions.npy',P);np.save(R/'selected.npy',selected);print(json.dumps(dict(recent=out['recent'],pointGate=out['pointGate'],choices=[(f['season'],f['choice']) for f in folds]),indent=2))
