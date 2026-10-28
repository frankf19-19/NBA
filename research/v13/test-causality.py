import os,json,copy,hashlib
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
import numpy as np
from features import generate
from evaluate import fit,paired_ci
R=Path(__file__).resolve().parent;rows=json.loads((R/'source.json').read_text(encoding='utf-8'));z=np.load(R.parent/'v7/clean-reference.npz');saved=np.load(R/'features.npz');pace=np.load(R.parent/'v12/features.npz')['detail'][:,0];changed=copy.deepcopy(rows);date='2024-11-01'
for e in changed:
 if e['d']>=date:
  e['hpts']+=30;e['apts']-=10;e['am']+=40
  if e['H'] is not None:e['H'][9]+=30
  if e['A'] is not None:e['A'][9]-=10
X,_,_=generate(changed,z['X'],pace);past=z['dates']<=date;future=z['dates']>date;assert np.array_equal(saved['X'][past],X[past]);assert not np.array_equal(saved['X'][future],X[future])
# Test absent-score-stat behavior instead: no per100 update when shot boxes are missing.
synthetic=[dict(id='1',d='2025-10-20',sy=2026,hid=1,aid=2,am=10,hpts=110,apts=100,H=None,A=None),dict(id='2',d='2025-10-21',sy=2026,hid=1,aid=2,am=5,hpts=100,apts=95,H=None,A=None)]
b=np.zeros((2,27));b[:,0]=1;small,_,valid=generate(synthetic,b,np.full(2,100.));assert not valid.any();assert np.array_equal(small[:,3,5:11],np.zeros((2,6)));assert np.any(small[1,1,5:11]!=0)
s=z['sy'];y=z['y'].copy();tr=(s>=2022)&(s<2026);old=fit(saved['X'][tr,2,:11],y[tr]);y[s>=2026]*=-1;new=fit(saved['X'][tr,2,:11],y[tr]);assert np.array_equal(old,new)
P=np.load(R/'predictions.npy');mask=(s>=2021)&np.isfinite(P).all(1);interval=paired_ci(mask,P[:,2],P[:,0],z['y'],z['dates'])
checks=dict(cutoff=date,pastAndSameDayUnchanged=int(past.sum()),changedFutureRows=int(np.any(abs(X-saved['X'])>1e-12,axis=(1,2)).sum()),missingPossessionsSkipEfficiencyUpdates=True,rawScoreModelStillUpdatesWithoutShotBoxes=True,targetSeasonScoresDoNotFitTheirCoefficients=True,sideShootingNetParityMaxError=float(abs(saved['sideNoise'][:,0]-saved['sideNoise'][:,1]-np.array(json.loads((R.parent/'v11/source.json').read_text(encoding='utf-8'))['noise'])).max()))
(R/'causality-checks.json').write_text(json.dumps(checks,indent=2));(R/'candidate-uncertainty.json').write_text(json.dumps(dict(candidate='regressedOffDef',n=int(mask.sum()),maeDifference=float(np.mean(abs(z['y'][mask]-P[mask,2])-abs(z['y'][mask]-P[mask,0]))),pairedDateCI95=interval,note='Retrospective descriptive uncertainty, not new blind evidence or corrected for repeated model comparisons'),indent=2));print(json.dumps(checks));print('candidate interval',interval)
files=['research/v7/clean-reference.npz','research/v7/clean-meta.json','research/v12/features.npz','research/v13/source.json','research/v13/features.npz','research/v13/predictions.npy'];manifest=dict(cutoff='2026-07-01',lastHistoricalGame=str(max(z['dates'])),records=len(z['y']),numpy=np.__version__,files=[dict(path=p,bytes=Path(p).stat().st_size,sha256=hashlib.sha256(Path(p).read_bytes()).hexdigest()) for p in files]);(R/'manifest.json').write_text(json.dumps(manifest,indent=2))
