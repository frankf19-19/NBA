import json,itertools
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
DEFAULT=np.array([100.,95.,20.]) # Points, possessions, three-point attempts; generic initial prior only.
def generate(meta):
 state=np.zeros((31,2,3));weight=np.zeros(31);league=np.zeros(3);count=0;prior=DEFAULT.copy();previous=None;F=[];detail=[]
 for date,group in itertools.groupby(meta,lambda e:e['d']):
  group=list(group);sy=group[0]['sy']
  if sy!=previous:
   if count:prior=league/count
   state*=.65;weight*=.65;league=np.zeros(3);count=0;previous=sy
  staged=[]
  for e in group:
   h,a=e['hid'],e['aid'];H=(state[h]+prior)/(weight[h]+1);A=(state[a]+prior)/(weight[a]+1)
   pace=(H[0,1]+A[0,1])/2;total=H[0,0]+A[1,0]+A[0,0]+H[1,0]-2*prior[0];threes=H[0,2]+A[1,2]+A[0,2]+H[1,2]-2*prior[2]
   F.append([(pace-prior[1])/5,(total-2*prior[0])/20,(threes-2*prior[2])/10]);detail.append([pace,total,threes,*prior])
   hs,aws=e['H'],e['A']
   if hs is None or aws is None:continue
   poss=(hs[1]+hs[3]-hs[6]+hs[8]+.44*hs[5]+aws[1]+aws[3]-aws[6]+aws[8]+.44*aws[5])/2
   if not 60<poss<150:continue
   staged.append((h,a,np.array([hs[9],poss,hs[3]]),np.array([aws[9],poss,aws[3]])))
  for h,a,H,A in staged:
   for tid,off,de in [(h,H,A),(a,A,H)]:state[tid]=.95*state[tid]+.05*np.array([off,de]);weight[tid]=.95*weight[tid]+.05
   league+=H+A;count+=2
 return np.array(F),np.array(detail)
if __name__=='__main__':
 rows=json.loads((R/'source.json').read_text(encoding='utf-8'));ref=json.loads((R.parent/'v7/clean-meta.json').read_text());assert [e['id'] for e in rows]==[e['id'] for e in ref];F,D=generate(rows);np.savez(R/'features.npz',X=F,detail=D);print('features',F.shape,'bounds',F.min(0),F.max(0))
