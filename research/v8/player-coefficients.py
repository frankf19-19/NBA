import os,sys,json,collections
from pathlib import Path
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R.parent/'pydeps'))
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import Ridge
meta=json.loads((R.parent/'v7/clean-meta.json').read_text());index={e['id']:i for i,e in enumerate(meta)};games=[]
for sy in range(2019,2027):
 for e in json.loads((R.parent/f'data/seed/ledger-{sy}.json').read_text(encoding='utf-8')):
  if e['id'] in index:games.append(e)
out={};audit=[]
for season in range(2021,2027):
 train=[e for e in games if season-2<=e['sy']<season and all(e.get('pl',{}).get(s) for s in ['h','a'])]
 ids=sorted({int(p['id']) for e in train for side in ['h','a'] for p in e['pl'][side] if p.get('min',0)>0});cols={pid:j for j,pid in enumerate(ids)};rr=[];cc=[];vv=[];target=[]
 for row,e in enumerate(train):
  for side,sign in [('h',1),('a',-1)]:
   for p in e['pl'][side]:
    if p.get('min',0)>0:rr.append(row);cc.append(cols[int(p['id'])]);vv.append(sign*float(p['min'])/48)
  target.append(e['am']-2.3)
 A=csr_matrix((vv,(rr,cc)),shape=(len(train),len(ids)));fit=Ridge(alpha=150,fit_intercept=False,solver='lsqr',tol=1e-8).fit(A,target);out[season]={pid:float(fit.coef_[j]) for pid,j in cols.items()};audit.append(dict(season=season,trainingSeasons=[season-2,season-1],games=len(train),players=len(ids)))
(R/'player-coefficients.json').write_text(json.dumps(out));(R/'coefficient-audit.json').write_text(json.dumps(audit,indent=2));print('Player coefficient audit',audit)
