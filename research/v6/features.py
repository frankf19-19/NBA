import json,itertools,sys,importlib.util
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('v2features',R.parent/'v2/features.py');v2=importlib.util.module_from_spec(sp);sp.loader.exec_module(v2)
# Initial generic prior; all later seasons use only previously completed seasons.
DEFAULT=np.array([.5,.30,.20,.14,.26,95,.48,.35])
def descriptors(H,A):
 poss=(H[1]+H[3]-H[6]+H[8]+.44*H[5]+A[1]+A[3]-A[6]+A[8]+.44*A[5])/2
 if not 60<poss<150:return None
 def one(v,o):
  fga=v[1]+v[3];return np.array([(v[0]+1.5*v[2])/max(1,fga),v[3]/max(1,fga),v[4]/max(1,fga),v[8]/poss,v[6]/max(1,v[6]+o[7]),poss,v[0]/max(1,v[1]),v[2]/max(1,v[3])])
 return one(H,A),one(A,H)
def build(rows):
 state=np.zeros((31,2,8));weight=np.zeros(31);league=np.zeros(8);ln=0;prior=DEFAULT.copy();prev=None;F=[]
 for d,g in itertools.groupby(rows,lambda e:e['d']):
  g=list(g);sy=g[0]['sy']
  if sy!=prev:
   if ln:prior=league/ln
   state*=.65;weight*=.65;league=np.zeros(8);ln=0;prev=sy
  staged=[]
  for e in g:
   h,a=e['hid'],e['aid'];H=(state[h]+prior)/(weight[h]+1);A=(state[a]+prior)/(weight[a]+1)
   # State uses .05 weighted observations; prior pseudo-games use same units.
   own=H[0]-A[0];allow=H[1]-A[1];cross=(H[0]-prior)*(A[1]-prior)-(A[0]-prior)*(H[1]-prior);pace=(H[0,5]+A[0,5])/2
   F.append(np.r_[own,allow,cross,pace]);hs,aws=v2.shots(e,'h'),v2.shots(e,'a')
   if hs is not None and aws is not None:
    pair=descriptors(hs,aws)
    if pair is not None:staged.append((h,a,*pair))
  for h,a,H,A in staged:
   for tid,off,de in [(h,H,A),(a,A,H)]:state[tid]=.95*state[tid]+.05*np.array([off,de]);weight[tid]=.95*weight[tid]+.05
   league+=H+A;ln+=2
 return np.array(F)
if __name__=='__main__':
 rows=v2.load();F=build(rows);np.save(R/'matchup.npy',F);(R/'ids.json').write_text(json.dumps([e['id'] for e in rows]));print('FEATURES',F.shape,flush=True)
 # Causality audit: perturb a late-season date and every subsequent outcome.
 n=next(i for i,e in enumerate(rows) if e['d']>='2026-03-01');date=rows[n]['d'];prefix=rows[:n+20];changed=json.loads(json.dumps(prefix))
 for e in changed[n:]:e['am']=150;e['ts']={};e['tst']={}
 F0=build(prefix);F1=build(changed);end=n
 while end<len(prefix) and prefix[end]['d']==date:end+=1
 assert np.array_equal(F0[:end],F1[:end]);assert not np.array_equal(F0[end:],F1[end:]);print('CAUSALITY passed',end,'rows unchanged through perturbed date',date,flush=True)
