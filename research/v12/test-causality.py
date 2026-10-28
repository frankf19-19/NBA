import os,json,sys,copy,hashlib
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
import numpy as np
from features import generate
from evaluate import base_probs,conditional
R=Path(__file__).resolve().parent;rows=json.loads((R/'source.json').read_text(encoding='utf-8'));z=np.load(R.parent/'v7/clean-reference.npz');F=np.load(R/'features.npz')['X'];Q=np.load(R/'probabilities.npy');oldQ=np.load(R.parent/'v10/probabilities.npy');mask=np.isfinite(Q[:,0]).all(1)&np.isfinite(oldQ[:,0]).all(1);err=float(abs(Q[mask,0]-oldQ[mask,0]).max());assert err<1e-14
cutoff='2024-11-01';changed=copy.deepcopy(rows)
for e in changed:
 if e['d']>=cutoff:
  for sd in ['H','A']:
   if e[sd] is not None:e[sd][9]+=25;e[sd][3]*=1.2
altered,_=generate(changed);past=z['dates']<=cutoff;future=z['dates']>cutoff;assert np.array_equal(F[past],altered[past]);assert not np.array_equal(F[future],altered[future])
# Permuting future/target-season outcomes cannot alter a model fitted before that season.
s=z['sy'];y=z['y'];p=z['base'];tr=(s>=2022)&(s<2025)&np.isfinite(p);te=np.where((s==2025)&np.isfinite(p))[0][:10];changedY=y.copy();changedY[s>=2025]*=-1
b=base_probs(p[tr],y[tr],p[te]);b2=base_probs(p[tr],changedY[tr],p[te]);assert np.array_equal(b,b2);a=conditional(p[tr],y[tr],F[tr],p[te],F[te],b);a2=conditional(p[tr],changedY[tr],F[tr],p[te],F[te],b2);assert np.array_equal(a,a2)
# Mirroring teams/margins retains context and swaps the two six-bin halves.
mb=base_probs(-p[tr],-y[tr],-p[te]);ma=conditional(-p[tr],-y[tr],F[tr],-p[te],F[te],mb);mirrorError=float(abs(a-ma[:,:,[6,7,8,9,10,11,0,1,2,3,4,5]]).max());assert mirrorError<1e-12
out=dict(cutoff=cutoff,pastAndSameDayUnchanged=int(past.sum()),changedFutureRows=int(np.any(abs(F-altered)>1e-12,axis=1).sum()),baselineProbabilityParityMaxError=err,mirrorMaxError=mirrorError,targetSeasonScoresDoNotFitTheirProbabilities=True)
(R/'causality-checks.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
files=['research/v7/clean-reference.npz','research/v7/clean-meta.json','research/v12/source.json','research/v12/features.npz','research/v12/probabilities.npy'];manifest=dict(cutoff='2026-07-01',lastHistoricalGame=str(max(z['dates'])),records=len(y),numpy=np.__version__,files=[dict(path=f,bytes=Path(f).stat().st_size,sha256=hashlib.sha256(Path(f).read_bytes()).hexdigest()) for f in files]);(R/'manifest.json').write_text(json.dumps(manifest,indent=2))
