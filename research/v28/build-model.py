import json,hashlib,importlib.util,datetime,collections
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent;spec=importlib.util.spec_from_file_location('eval15',R.parent/'v15/evaluate.py');ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
z=np.load(R.parent/'v7/clean-reference.npz');roles=np.load(R.parent/'v19/features.npz')['X'];X=np.c_[z['X'][:,[0,2,3,4,5,14,15,16]],roles];m=(z['sy']>=2023)&(z['sy']<=2026);coeff=ev.fit(X[m],z['y'][m]);locked=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z');p=dict(season=2027,featureVersion='role-study-features-v1',coreColumns=[0,2,3,4,5,14,15,16],trainSeasons=[2023,2024,2025,2026],trainThrough=str(max(z['dates'][m])),trainN=int(m.sum()),coefficients=coeff.tolist(),lockedAt=locked,eligibleFromDate='2026-10-30');target=R.parent.parent/'role-study-model.json'
if target.exists():
 model=json.loads(target.read_text());old=json.loads(model['parametersText']);assert model['modelId']==hashlib.sha256(model['parametersText'].encode()).hexdigest();assert old['trainSeasons']==p['trainSeasons'] and old['trainThrough']==p['trainThrough'] and old['coreColumns']==p['coreColumns'] and np.allclose(old['coefficients'],coeff,rtol=0,atol=1e-12),'Locked model differs; do not overwrite';p=old;locked=old['lockedAt']
else:
 payload=json.dumps(p,separators=(',',':'));model=dict(schema=1,version='role-study-v1',mode='shadow',pointEnabled=False,modelId=hashlib.sha256(payload.encode()).hexdigest(),parametersText=payload);target.write_text(json.dumps(model,separators=(',',':')),encoding='utf-8')
print(json.dumps(dict(modelId=model['modelId'],trainN=p['trainN'],lockedAt=locked)))
# Independent Python/JS role-feature fixtures; no outcome scoring or backfilled predictions.
meta=json.loads((R.parent/'v7/clean-meta.json').read_text());lookup={}
for f in (R.parent/'data/seed').glob('ledger-*.json'):
 for g in json.loads(f.read_text(encoding='utf-8-sig')):lookup[str(g['id'])]=g
spec=importlib.util.spec_from_file_location('role19',R.parent/'v19/features.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
fixtures=[];wanted=['2023-10-24','2025-03-01','2026-04-12'];seen=set();current=collections.defaultdict(list);prev=collections.defaultdict(list);season=None
for i,e in enumerate(meta):
 if e['sy']!=season:prev=current;current=collections.defaultdict(list);season=e['sy']
 if e['d'] in wanted and e['d'] not in seen:
  sides=[]
  for t in [e['hid'],e['aid']]:
   h=current[t][-10:] if len(current[t])>=6 else prev[t][-10:];sides.append(h)
  fixtures.append(dict(date=e['d'],histories=sides,expectedRole=roles[i].tolist(),expectedCore=X[i,:8].tolist(),f=lookup[str(e['id'])]['f'],homeId=e['hid'],awayId=e['aid']));seen.add(e['d'])
 # Fixtures use first game of each date: no same-day earlier team update can enter chosen first-game context.
 g=lookup[str(e['id'])];h,a=v.box(g,'h'),v.box(g,'a')
 if h is not None and a is not None:current[e['hid']].append(h);current[e['aid']].append(a)
(R/'parity-fixtures.json').write_text(json.dumps(fixtures,separators=(',',':')),encoding='utf-8');assert len(fixtures)==3

