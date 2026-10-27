import json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent;z=np.load(R.parent/'v2/features.npz');sy=z['sy'];y=z['y'];dates=z['dates'];p=np.load(R.parent/'v2/predictions.npy')[:,2];meta=json.loads((R.parent/'v2/meta.json').read_text());phase=z['X'][:,26]*180;mask=(sy>=2021)&np.isfinite(p)
def met(m):
 return dict(n=int(m.sum()),mae=float(abs(y[m]-p[m]).mean()),bias=float((y[m]-p[m]).mean()),predictedAbs=float(abs(p[m]).mean()),actualSignedTowardFavorite=float((y[m]*np.sign(p[m])).mean()),winner=float(((y[m]>0)==(p[m]>=0)).mean()))
r={'strength':{},'phase':{},'season':{}}
for lo,hi in [(0,3),(3,6),(6,10),(10,100)]:r['strength'][str((lo,hi))]=met(mask&(abs(p)>=lo)&(abs(p)<hi))
for lo,hi in [(0,14),(14,30),(30,120),(120,1000)]:r['phase'][str((lo,hi))]=met(mask&(phase>=lo)&(phase<hi))
for season in range(2021,2027):r['season'][season]=met(mask&(sy==season))
(R/'diagnostics.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
