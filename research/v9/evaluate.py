import json,numpy as np
from pathlib import Path
r=json.loads(Path('research/v9/replay.json').read_text(encoding='utf-8'))
def metrics(a,key):
 y=np.array([e['y'] for e in a]);p=np.array([e[key] for e in a]);return dict(n=len(a),mae=float(abs(y-p).mean()),rmse=float(np.sqrt(((y-p)**2).mean())),winner=float(((y>0)==(p>=0)).mean()))
a=[e for e in r if e['restEligible']];out=dict(scope='retrospective same-season gaps 2-14 days; prior completed physical games; no injury; legacy is annual historical fallback proxy, not reconstructed live website',eligible=dict(legacy=metrics(a,'legacy'),quality=metrics(a,'quality')),annual=[dict(season=s,legacy=metrics([e for e in a if e['sy']==s],'legacy'),quality=metrics([e for e in a if e['sy']==s],'quality')) for s in range(2021,2027)],dates=sorted(set(e['d'] for e in a)))
Path('research/v9/results.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
