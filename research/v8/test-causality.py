import subprocess,sys,json,numpy as np
from pathlib import Path
R=Path(__file__).resolve().parent
subprocess.run([sys.executable,str(R/'features.py'),'--perturb-from','2025-01-02','--output','audit-future-features.json'],capture_output=True,check=True)
a=json.loads((R/'features.json').read_text(encoding='utf-8'));b=json.loads((R/'audit-future-features.json').read_text(encoding='utf-8'));pairs=zip(a['rows'],b['rows']);unchanged=0;changed=0
for x,z in pairs:
 assert x['id']==z['id']
 if x['d']<='2025-01-02':
  assert x['x']==z['x'] and x['players']==z['players'] and x['base']==z['base'];unchanged+=1
 else:changed+=x['x']!=z['x']
assert changed>0
labels=json.loads((R/'features.json').read_text(encoding='utf-8'))
for e in labels['rows']:
 if e['sy']==2024:e['appearanceLabels']=[1-v for v in e['appearanceLabels']]
(R/'audit-labels.json').write_text(json.dumps(labels),encoding='utf-8')
subprocess.run([sys.executable,str(R/'availability.py'),'--features','audit-labels.json','--prefix','audit-availability'],capture_output=True,check=True)
P=np.load(R/'availability-predictions.npy');Q=np.load(R/'audit-availability-predictions.npy');sy=np.array([e['sy'] for e in a['rows']]);assert np.allclose(P[sy==2024],Q[sy==2024],equal_nan=True);assert not np.allclose(P[sy==2025],Q[sy==2025],equal_nan=True)
co=json.loads((R/'coefficient-audit.json').read_text());assert all(max(x['trainingSeasons'])<x['season'] for x in co)
out=dict(priorAndSameDateFeatureRowsUnchanged=unchanged,laterFeatureRowsChanged=changed,currentSeasonLabelsDoNotChangeCurrentSeasonPredictions=True,priorSeasonLabelsDoChangeNextSeasonPredictions=True,playerCoefficientsUsePriorSeasonsOnly=True);(R/'causality-checks.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
