import json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent
NAMES=['current','carry35','carry85','uncertainty','adaptiveUncertainty','observedRoster','splitPrior']
def fit(x,y):
 s=x.std(0);s[s<1e-6]=1;a=x/s;pen=np.eye(x.shape[1])*10;pen[0,0]=1e-8;return np.linalg.solve(a.T@a+pen,a.T@y)/s
def metrics(mask,p,y):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(((t-v)**2).mean())),winner=float(((t>0)==(v>=0)).mean()))
def ci(mask,p,b,y,dates):
 ds=sorted(set(dates[mask]));delta=abs(y-p)-abs(y-b);s=np.array([delta[mask&(dates==d)].sum() for d in ds]);n=np.array([(mask&(dates==d)).sum() for d in ds]);ix=np.random.default_rng(20261028).integers(0,len(ds),(3000,len(ds)));return np.quantile(s[ix].sum(1)/n[ix].sum(1),[.025,.975]).tolist()
if __name__=='__main__':
 z=np.load(R/'features.npz');X=z['X'];sy=z['sy'];y=z['y'];dates=z['dates'];early=z['early'];base=z['base'];P=np.tile(base[:,None],(1,7))
 for season in range(2005,2027):
  tr=(sy>=season-4)&(sy<season);te=(sy==season)&np.isfinite(base)
  for k in range(1,7):
   P[te,k]=X[te,k]@fit(X[tr,k],y[tr])
   if k==5:P[te&~z['coverage'].all(1),k]=base[te&~z['coverage'].all(1)]
 # Verify independent rebuild of the fixed reference's point fitting.
 maxerr=0
 for season in range(2021,2027):
  tr=(sy>=season-4)&(sy<season);te=sy==season;rebuilt=X[te,0]@fit(X[tr,0],y[tr]);maxerr=max(maxerr,float(abs(rebuilt-base[te]).max()))
 assert maxerr<1e-8,maxerr
 selected=base.copy();folds=[]
 for season in range(2015,2027):
  val=(sy>=season-3)&(sy<season)&early&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);ms=[metrics(val,P[:,k],y) for k in range(7)];b=ms[0]
  eligible=[k for k in range(1,7) if val.sum()>=300 and ms[k]['mae']<=b['mae']-.05 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min((ms[k]['mae'] for k in eligible),default=0);choice=next((k for k in eligible if ms[k]['mae']<=best+.02),0)
  selected[te&early]=P[te&early,choice]
  folds.append(dict(season=season,choice=NAMES[choice],early=dict(baseline=metrics(te&early,base,y),selected=metrics(te&early,selected,y),all={n:metrics(te&early,P[:,k],y) for k,n in enumerate(NAMES)}),full=dict(baseline=metrics(te,base,y),selected=metrics(te,selected,y))))
 mask=(sy>=2021)&np.isfinite(P).all(1);opening=mask&early;b=metrics(opening,base,y);a=metrics(opening,selected,y);fullB=metrics(mask,base,y);fullA=metrics(mask,selected,y);interval=ci(opening,selected,base,y,dates);improved=sum(f['early']['selected']['mae']<f['early']['baseline']['mae'] for f in folds if f['season']>=2021)
 result=dict(names=NAMES,scope='Repeated retrospective research; first30 calendar-day policy; no new blind test; no injury; fixed current-family reference',baselineRebuildMaxError=maxerr,folds=folds,recent=dict(early=dict(baseline=b,selected=a,all={n:metrics(opening,P[:,k],y) for k,n in enumerate(NAMES)},maeDifferenceCI95=interval),full=dict(baseline=fullB,selected=fullA),rosterBothCoverageEarly=int(z['coverage'][opening].all(1).sum()),rosterBothCoverageFull=int(z['coverage'][mask].all(1).sum()),improvedEarlyYears=improved),gate=bool(a['mae']<=b['mae']-.1 and interval[1]<0 and improved>=4 and fullA['mae']<=fullB['mae'] and fullA['rmse']<=fullB['rmse'] and fullA['winner']>=fullB['winner']))
 (R/'results.json').write_text(json.dumps(result,indent=2));np.save(R/'predictions.npy',P);np.save(R/'selected.npy',selected);print(json.dumps(dict(recent=result['recent'],gate=result['gate'],choices=[(f['season'],f['choice']) for f in folds]),indent=2))
