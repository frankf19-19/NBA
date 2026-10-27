import json,numpy as np
from pathlib import Path
r=Path('research/v4');z=np.load(r/'features.npz');sy=z['sy'];y=z['y'];P=np.load('research/v2/predictions.npy');q=np.load(r/'ensemble-predictions.npy')[:,0]
mask=(sy>=2021)&np.isfinite(q);out={}
for name,b in [('nestedCurrent',z['base']),('fixedRegress3',P[:,2])]:
 out[name]=[]
 for season in range(2021,2027):
  m=mask&(sy==season);out[name].append({'season':season,'n':int(m.sum()),'baselineMAE':float(abs(y[m]-b[m]).mean()),'ensembleMAE':float(abs(y[m]-q[m]).mean()),'delta':float((abs(y[m]-q[m])-abs(y[m]-b[m])).mean())})
 print(name,'recentDelta',float((abs(y[mask]-q[mask])-abs(y[mask]-b[mask])).mean()),'exclude2022',float((abs(y[mask&(sy!=2022)]-q[mask&(sy!=2022)])-abs(y[mask&(sy!=2022)]-b[mask&(sy!=2022)])).mean()))
(r/'sensitivity.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
