import json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent
NAMES=['current','rawOffDef','regressedOffDef','efficiency','efficiencyPace','combined','combinedInteractions'];COLS=[8,11,11,11,11,14,17]
def fit(x,y):
 scale=x.std(0);scale[scale<1e-6]=1;a=x/scale;pen=np.eye(x.shape[1])*10;pen[0,0]=1e-8;return np.linalg.solve(a.T@a+pen,a.T@y)/scale
def metrics(mask,p,y):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(((t-v)**2).mean())),winner=float(((t>0)==(v>=0)).mean()))
def paired_ci(mask,p,b,y,dates):
 ds=sorted(set(dates[mask]));delta=abs(y-p)-abs(y-b);sums=np.array([delta[(dates==d)&mask].sum() for d in ds]);ns=np.array([((dates==d)&mask).sum() for d in ds]);ix=np.random.default_rng(20261028).integers(0,len(ds),(3000,len(ds)));return np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist()
if __name__=='__main__':
 z=np.load(R.parent/'v7/clean-reference.npz');X=np.load(R/'features.npz')['X'];s=z['sy'];y=z['y'];p=z['base'];dates=z['dates'];P=np.tile(p[:,None],(1,7));rebuildError=0
 for season in range(2005,2027):
  tr=(s>=season-4)&(s<season);te=(s==season)&np.isfinite(p)
  for k in range(1,7):P[te,k]=X[te,k,:COLS[k]]@fit(X[tr,k,:COLS[k]],y[tr])
  if season>=2021:rebuildError=max(rebuildError,float(abs(X[te,0,:8]@fit(X[tr,0,:8],y[tr])-p[te]).max()))
 assert rebuildError<1e-8,rebuildError
 selected=p.copy();folds=[]
 for season in range(2015,2027):
  val=(s>=season-3)&(s<season)&np.isfinite(P).all(1);te=(s==season)&np.isfinite(P).all(1);ms=[metrics(val,P[:,k],y) for k in range(7)];b=ms[0];eligible=[k for k in range(1,7) if ms[k]['mae']<=b['mae']-.03 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min((ms[k]['mae'] for k in eligible),default=0);choice=next((k for k in eligible if ms[k]['mae']<=best+.02),0);selected[te]=P[te,choice];folds.append(dict(season=season,choice=NAMES[choice],baseline=metrics(te,p,y),selected=metrics(te,selected,y),all={n:metrics(te,P[:,k],y) for k,n in enumerate(NAMES)}))
 mask=(s>=2021)&np.isfinite(P).all(1);a=metrics(mask,selected,y);b=metrics(mask,p,y);ci=paired_ci(mask,selected,p,y,dates);improved=sum(f['selected']['mae']<f['baseline']['mae'] for f in folds if f['season']>=2021)
 out=dict(names=NAMES,scope='Repeated retrospective offense/defense study, clean fixed regress3 reference, no injury or market inputs',baselineRebuildMaxError=rebuildError,folds=folds,recent=dict(baseline=b,selected=a,all={n:metrics(mask,P[:,k],y) for k,n in enumerate(NAMES)},maeDifferenceCI95=ci,improvedYears=improved),gate=bool(a['mae']<=b['mae']-.05 and a['rmse']<=b['rmse'] and a['winner']>=b['winner'] and improved>=5 and ci[1]<0));(R/'results.json').write_text(json.dumps(out,indent=2));np.save(R/'predictions.npy',P);np.save(R/'selected.npy',selected);print(json.dumps(dict(recent=out['recent'],gate=out['gate'],choices=[(f['season'],f['choice']) for f in folds]),indent=2))
