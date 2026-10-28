import copy,json
from pathlib import Path
import numpy as np
from features import generate
from evaluate import fit
R=Path(__file__).resolve().parent;source=json.loads((R/'source.json').read_text(encoding='utf-8'));meta=source['meta'];ref=json.loads((R.parent/'v7/clean-meta.json').read_text());z=np.load(R.parent/'v7/clean-reference.npz');saved=np.load(R/'features.npz');noise=np.array(source['noise']);cutoff='2024-11-01';past=z['dates']<=cutoff;future=z['dates']>cutoff
for e,r in zip(meta,ref):e['am']=r['am']
changed=copy.deepcopy(meta);n=noise.copy()
for i,e in enumerate(changed):
 if e['d']>=cutoff:e['am']=-e['am']+23;n[i]+=17
X,early,cov=generate(changed,n,z['X']);assert np.array_equal(saved['X'][past],X[past]);assert not np.array_equal(saved['X'][future],X[future])
changed=copy.deepcopy(meta)
for e in changed:
 if e['d']>=cutoff:e['players']=[[[str(100000000+int(pid)),mins] for pid,mins in players] for players in e['players']]
P,_,_=generate(changed,noise,z['X']);assert np.array_equal(saved['X'][past],P[past]);assert not np.array_equal(saved['X'][future,5],P[future,5]);assert np.array_equal(saved['X'][:,0],P[:,0])
mask=z['sy']<2026;train=(z['sy']>=2022)&mask;y=z['y'].copy();y[~mask]*=-1;coefA=fit(saved['X'][train,3],z['y'][train]);coefB=fit(saved['X'][train,3],y[train]);assert np.array_equal(coefA,coefB)
missing=~saved['coverage'].all(1);assert np.array_equal(saved['X'][missing,5],saved['X'][missing,0])
out=dict(cutoff=cutoff,unchangedPastAndSameDay=int(past.sum()),changedFutureRows=int(np.any(abs(X-saved['X'])>1e-10,axis=(1,2)).sum()),changedFutureRosterRows=int(np.any(abs(P[:,5]-saved['X'][:,5])>1e-10,axis=1).sum()),currentGamePointsAndRosterNeverPredictThemselves=True,invalidRosterFeaturesEqualBaseline=True,targetSeasonScoresDoNotFitItsCoefficients=True,baselineRatingMaxError=float(np.max(abs(saved['X'][:,0,5:8]-z['X'][:,14:17]))))
(R/'causality-checks.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
