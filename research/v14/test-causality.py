import json,copy,hashlib
from pathlib import Path
import numpy as np
from features import generate
from evaluate import series_features,fit
R=Path(__file__).resolve().parent;src=json.loads((R/'source.json').read_text(encoding='utf-8'));rows=src['rows'];old=json.loads((R.parent/'v11/source.json').read_text(encoding='utf-8'));noise={str(e['id']):v for e,v in zip(old['meta'],old['noise'])};saved=np.load(R/'features.npz');cutoff='2024-11-01';changed=copy.deepcopy(rows);alteredNoise=noise.copy()
for e in changed:
 if e['d']>=cutoff:
  e['y']+=31
  if e['reg']:alteredNoise[e['id']]+=9
X=generate(changed,src['calendar'],alteredNoise);dates=np.array([e['d'] for e in rows]);past=dates<=cutoff;assert np.array_equal(X[past],saved['X'][past]);assert not np.array_equal(X[~past],saved['X'][~past])
po=[e for e in rows if not e['reg'] and e['proxy'] is not None and e['sy']>=2005];F,number,keys=series_features(po);changed=copy.deepcopy(po);cut='2025-05-01'
for e in changed:
 if e['d']>=cut:e['y']=-e['y']+13
F2,num2,key2=series_features(changed);d=np.array([e['d'] for e in po]);before=d<=cut;assert np.array_equal(F[before],F2[before]);assert np.array_equal(number,num2);assert np.array_equal(keys,key2);assert not np.array_equal(F[~before],F2[~before]);assert np.all(F[number==0,2:4]==0)
s=np.array([e['sy'] for e in po]);y=np.array([e['y'] for e in po]);p=np.array([e['proxy'] for e in po]);tr=np.isin(s,[2022,2023,2024,2025]);c1=fit(F[tr],y[tr]-p[tr]);y[s>=2026]*=-1;c2=fit(F[tr],y[tr]-p[tr]);assert np.array_equal(c1,c2)
checks=dict(ratingCutoff=cutoff,ratingPastAndSameDayUnchanged=int(past.sum()),seriesCutoff=cut,seriesPastAndSameDayUnchanged=int(before.sum()),changedLaterSeriesRows=int(np.any(abs(F-F2)>1e-12,axis=1).sum()),firstSeriesGameHasNoSeriesResultFeature=True,targetSeasonOutcomesDoNotFitItsCoefficients=True,seriesGamesAndKeysIndependentOfFutureScores=True)
(R/'causality-checks.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks));files=['research/v14/source.json','research/v14/features.npz','research/v14/predictions.npz','research/v7/clean-reference.npz','research/v11/source.json'];manifest=dict(cutoff='2026-07-01',lastHistoricalGame=max(e['d'] for e in rows),rows=len(rows),regular=int(saved['regular'].sum()),fullPlayoffs=int((~saved['regular']).sum()),numpy=np.__version__,files=[dict(path=p,bytes=Path(p).stat().st_size,sha256=hashlib.sha256(Path(p).read_bytes()).hexdigest()) for p in files]);(R/'manifest.json').write_text(json.dumps(manifest,indent=2))
