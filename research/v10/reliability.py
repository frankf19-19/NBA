import json,numpy as np
from pathlib import Path
R=Path('research/v10');z=np.load('research/v7/clean-reference.npz');Q=np.load(R/'probabilities.npy');sy=z['sy'];y=z['y'];mask=(sy>=2021)&np.isfinite(Q).all((1,2));c=np.minimum((np.abs(y).astype(int)-1)//5,5)+(y<0)*6
out={}
for k,name in [(0,'kernel'),(4,'halfFactorized')]:
 q=Q[mask,k];t=c[mask];pick=q.argmax(1);confidence=q.max(1);out[name]=dict(n=len(t),hits=int((pick==t).sum()),meanTopProbability=float(confidence.mean()),actualTopAccuracy=float((pick==t).mean()),reliability=[])
 for lo,hi in [(0,.15),(.15,.2),(.2,.25),(.25,1.01)]:
  m=(confidence>=lo)&(confidence<hi);out[name]['reliability'].append(dict(lower=lo,upper=min(hi,1),n=int(m.sum()),meanProbability=float(confidence[m].mean()) if m.any() else None,observedAccuracy=float((pick[m]==t[m]).mean()) if m.any() else None))
Path('research/v10/reliability.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
