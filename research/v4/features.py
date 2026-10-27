import json,datetime,itertools,collections
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent;z=np.load(R.parent/'v2/features.npz');old=z['X'];noise=z['noise'];sy=z['sy'];y=z['y'];dates=z['dates'];meta=json.loads((R.parent/'v2/meta.json').read_text());base=np.load(R.parent/'v2/selected.npy');rates=np.array([.04,.08,.12]);state=np.zeros((6,3,31));games=np.zeros(31);last={};features=[];prev=None
for date,grp in itertools.groupby(enumerate(meta),lambda t:t[1]['d']):
 grp=list(grp);season=grp[0][1]['sy'];day=datetime.date.fromisoformat(date)
 if season!=prev:state*=.65;games*=0;last={};prev=season
 # Gap decay applied BEFORE predicting; only historical dates used.
 for tid in {t for i,e in grp for t in [e['hid'],e['aid']]}:
  gap=(day-last[tid]).days if tid in last else 0
  state[3,:,tid]*=np.exp(-gap/90)
 delta=np.zeros_like(state)
 for i,e in grp:
  h,a=e['hid'],e['aid'];pace=old[i,24];pace=pace if 70<pace<130 else 100
  fs=state[:,:,h]-state[:,:,a];f=[]
  for k in range(6):
   v=fs[k]*(pace/100 if k==4 else 1);f.append([*old[i,[0,2,3,4,5]],*v])
  features.append(f);target=y[i]+.5*noise[i,0]
  for k in range(6):
   residual=(target*100/pace if k==4 else target)-(2.3+fs[k])
   if k==0:residual=np.clip(residual,-15,15)
   elif k==1:residual=20*np.tanh(residual/20)
   else:residual=np.clip(residual,-35,35)
   mult=2 if k==2 and min(games[h],games[a])<10 else 1
   if k==5:
    # A different observation: remove half the two-point shooting surprise too.
    residual=np.clip(y[i]+.5*noise[i,1]-(2.3+fs[k]),-20,20)
   v=rates*mult*residual;delta[k,:,h]+=v;delta[k,:,a]-=v
 state+=delta
 for i,e in grp:
  for t in [e['hid'],e['aid']]:games[t]+=1;last[t]=day
X=np.array(features);np.savez(R/'features.npz',X=X,sy=sy,y=y,dates=dates,base=base)
print('FEATURES',X.shape)
