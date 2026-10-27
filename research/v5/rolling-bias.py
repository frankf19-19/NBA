import json,itertools,datetime,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent;z=np.load(R.parent/'v2/features.npz');sy=z['sy'];y=z['y'];dates=z['dates'];base=np.load(R.parent/'v2/predictions.npy')[:,2];P=np.tile(base[:,None],(1,4));history=[];ema=0.;last=None
for d,grp in itertools.groupby(range(len(y)),lambda i:dates[i]):
 grp=list(grp);day=datetime.date.fromisoformat(d)
 if last and (day-last).days>120:ema*=.5
 history=[e for e in history if (day-e[0]).days<=365]
 for k,n in [(1,200),(2,500)]:
  h=history[-n:];c=np.mean([e[1] for e in h])*len(h)/(len(h)+200) if h else 0
  P[grp,k]+=np.clip(c,-2,2)
 P[grp,3]+=np.clip(ema,-2,2)
 residual=[y[i]-base[i] for i in grp if np.isfinite(base[i])]
 if residual:
  alpha=1-np.exp(-len(residual)*np.log(2)/200);ema=(1-alpha)*ema+alpha*np.mean(np.clip(residual,-25,25));history.extend((day,v) for v in residual)
 last=day
names=['current','rolling200','rolling500','ewma200'];folds=[];selected=np.full(len(y),np.nan)
def met(m,p):
 t=y[m];v=p[m];return dict(n=int(m.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(np.mean((t-v)**2))),winner=float(((t>0)==(v>=0)).mean()))
for season in range(2015,2027):
 tr=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);ms=[met(tr,P[:,k]) for k in range(4)];b=ms[0];ok=[k for k in range(1,4) if ms[k]['mae']<=b['mae']-.03 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.005];best=min([ms[k]['mae'] for k in ok],default=0);choice=next((k for k in ok if ms[k]['mae']<=best+.01),0);selected[te]=P[te,choice];folds.append(dict(season=season,choice=names[choice],baseline=met(te,base),selected=met(te,selected),all={names[k]:met(te,P[:,k]) for k in range(4)}))
mask=(sy>=2021)&np.isfinite(selected);r=dict(names=names,folds=folds,recent=dict(baseline=met(mask,base),selected=met(mask,selected),all={names[k]:met(mask,P[:,k]) for k in range(4)}));(R/'bias-results.json').write_text(json.dumps(r,indent=2));np.save(R/'bias-predictions.npy',P);print(json.dumps(r['recent'],indent=2));print('CHOICES',[(f['season'],f['choice']) for f in folds])
