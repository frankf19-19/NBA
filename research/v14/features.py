import json,itertools,collections
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
RATES=np.array([.04,.08,.12])
def generate(rows,calendar,noise):
 ratings=np.zeros((3,31));previous=None;last=[collections.deque(maxlen=4) for _ in range(31)];ci=0;out=[]
 for date,grp in itertools.groupby(rows,lambda e:e['d']):
  grp=list(grp);sy=grp[0]['sy']
  if sy!=previous:ratings*=.65;last=[collections.deque(maxlen=4) for _ in range(31)];previous=sy
  while ci<len(calendar) and calendar[ci]['d']<date:
   c=calendar[ci];ci+=1
   if c['sy']==sy:
    for t in [c['hid'],c['aid']]:last[t].append(c['d'])
  delta=np.zeros_like(ratings)
  for e in grp:
   def fatigue(t):return int(sum(0<(np.datetime64(date)-np.datetime64(d)).astype(int)<=3 for d in last[t])>=2)
   h,a=e['hid'],e['aid'];out.append([1,*e['f']['x'][:3],fatigue(h)-fatigue(a),*(ratings[:,h]-ratings[:,a])])
   if e['reg']:
    target=e['y']+.5*noise[e['id']];res=np.clip(target-(2.3+ratings[:,h]-ratings[:,a]),-35,35);v=RATES*res;delta[:,h]+=v;delta[:,a]-=v
  ratings+=delta
 return np.array(out)
if __name__=='__main__':
 source=json.loads((R/'source.json').read_text(encoding='utf-8'));old=json.loads((R.parent/'v11/source.json').read_text(encoding='utf-8'));noise={str(e['id']):v for e,v in zip(old['meta'],old['noise'])};X=generate(source['rows'],source['calendar'],noise);ref=np.load(R.parent/'v7/clean-reference.npz');reg=np.array([e['reg'] for e in source['rows']]);error=float(abs(X[reg]-ref['X'][:,[0,2,3,4,5,14,15,16]]).max());assert error<1e-10,error
 np.savez(R/'features.npz',X=X,regular=reg);print(json.dumps(dict(rows=len(X),regular=int(reg.sum()),playoffs=int((~reg).sum()),regularFeatureMaxError=error)))
