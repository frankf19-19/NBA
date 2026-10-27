import sys,json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent));from analyze import empirical_probs,metrics
z=np.load(R.parent/'v2/features.npz');sy=z['sy'];y=z['y'];P=np.load(R/'predictions.npy');names=json.loads((R/'results.json').read_text())['names'];probs=np.full((len(y),len(names),12),np.nan);folds=[]
for season in range(2021,2027):
 tr=(sy>=season-3)&(sy<season)&np.isfinite(P).all(1);te=(sy==season)&np.isfinite(P).all(1);annual={}
 for k,name in enumerate(names):
  grid=empirical_probs(P[tr,k],y[tr],np.arange(161)*.25,'kernel',2,100);grid[0,:6]=grid[0,6:]=(grid[0,:6]+grid[0,6:])/2
  for i in np.where(te)[0]:
   pos=min(160,abs(P[i,k])/.25);lo=int(pos);hi=min(160,lo+1);q=grid[lo]*(1-pos+lo)+grid[hi]*(pos-lo)
   if P[i,k]<0:q=np.r_[q[6:],q[:6]]
   probs[i,k]=q/q.sum()
  annual[name]=metrics(y[te],P[te,k],probs[te,k])
 folds.append(dict(season=season,models=annual))
mask=(sy>=2021)&np.isfinite(probs).all((1,2));r=dict(folds=folds,recent={name:metrics(y[mask],P[mask,k],probs[mask,k]) for k,name in enumerate(names)});(R/'bin-results.json').write_text(json.dumps(r,indent=2));print(json.dumps(r['recent'],indent=2))
