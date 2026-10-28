import json,itertools,datetime
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
NAMES=['current','carry35','carry85','uncertainty','adaptiveUncertainty','observedRoster','splitPrior']
RATES=np.array([.04,.08,.12]);PROCESS=np.array([.25,1.,4.])[:,None]
def generate(meta,noise,baseX):
 state=np.zeros((3,3,31));prior=np.zeros((3,31));km=np.zeros((2,3,31));variance=np.full((2,3,31),25.);shock=np.zeros((3,31));previous=None;first={};X=[];early=[];rosterOK=[]
 previousMinutes=[{} for _ in range(31)];currentMinutes=[{} for _ in range(31)];previousGP=np.zeros(31);currentGP=np.zeros(31)
 for date,group in itertools.groupby(enumerate(meta),lambda z:z[1]['d']):
  group=list(group);sy=group[0][1]['sy']
  if sy!=previous:
   state*=np.array([.65,.35,.85])[:,None,None];prior=state[0].copy();km*=.65
   variance=variance*.65**2+25 if previous is not None else variance
   shock*=0;previousMinutes=currentMinutes;previousGP=currentGP;currentMinutes=[{} for _ in range(31)];currentGP=np.zeros(31);first[sy]=date;previous=sy
  teams={t for _,e in group for t in [e['hid'],e['aid']]}
  for t in teams:
   variance[0,:,t]+=PROCESS[:,0];variance[1,:,t]+=PROCESS[:,0]*(1+np.minimum(3,shock[:,t]**2/64))
  delta=np.zeros_like(state);dp=np.zeros_like(prior);dk=np.zeros_like(km);dv=np.zeros_like(variance);ds=np.zeros_like(shock)
  for i,e in group:
   h,a=e['hid'],e['aid'];features=np.zeros((7,11));features[:,:5]=baseX[i,[0,2,3,4,5]]
   features[:3,5:8]=state[:,:,h]-state[:,:,a];features[3:5,5:8]=km[:,:,h]-km[:,:,a]
   roster=state[0].copy();coverage=[]
   for t in [h,a]:
    valid=previousGP[t]>=40 and currentGP[t]>=3 and sum(previousMinutes[t].values())>0 and sum(currentMinutes[t].values())>0;coverage.append(bool(valid))
    if valid:
     old=previousMinutes[t];new=currentMinutes[t];totOld=sum(old.values());totNew=sum(new.values());overlap=sum(min(v/totOld,new.get(pid,0)/totNew) for pid,v in old.items());carry=.35+.5*overlap
     roster[:,t]+=(carry/.65-1)*prior[:,t]
   features[5,5:8]=(roster[:,h]-roster[:,a]) if all(coverage) else (state[0,:,h]-state[0,:,a]);features[6,5:8]=state[0,:,h]-state[0,:,a];features[6,8:11]=prior[:,h]-prior[:,a]
   X.append(features);early.append((datetime.date.fromisoformat(date)-datetime.date.fromisoformat(first[sy])).days<30);rosterOK.append(coverage)
   target=e['am']+.5*noise[i]
   for k in range(3):
    residual=target-(2.3+state[k,:,h]-state[k,:,a]);v=RATES*np.clip(residual,-35,35);delta[k,:,h]+=v;delta[k,:,a]-=v
    if k==0:
     derivative=(abs(residual)<35).astype(float);pv=-RATES*derivative*(prior[:,h]-prior[:,a]);dp[:,h]+=pv;dp[:,a]-=pv
   for k in range(2):
    residual=np.clip(target-(2.3+km[k,:,h]-km[k,:,a]),-35,35);ph=variance[k,:,h];pa=variance[k,:,a];den=ph+pa+144;dk[k,:,h]+=ph/den*residual;dk[k,:,a]-=pa/den*residual;dv[k,:,h]-=ph**2/den;dv[k,:,a]-=pa**2/den
    if k==1:ds[:,h]+=.2*(residual-shock[:,h]);ds[:,a]+=.2*(-residual-shock[:,a])
  state+=delta;prior+=dp;km+=dk;variance+=dv;shock+=ds
  for _,e in group:
   for t,players in zip([e['hid'],e['aid']],e['players']):
    if 180<=sum(p[1] for p in players)<=350 and len(players)>=5:
     currentGP[t]+=1
     for pid,minutes in players:currentMinutes[t][pid]=currentMinutes[t].get(pid,0)+minutes
 return np.array(X),np.array(early),np.array(rosterOK)
if __name__=='__main__':
 source=json.loads((R/'source.json').read_text(encoding='utf-8'));meta=source['meta'];z=np.load(R.parent/'v7/clean-reference.npz');ref=json.loads((R.parent/'v7/clean-meta.json').read_text());assert [e['id'] for e in meta]==[e['id'] for e in ref]
 for e,r in zip(meta,ref):e['am']=r['am']
 X,early,coverage=generate(meta,source['noise'],z['X']);error=float(np.max(abs(X[:,0,5:8]-z['X'][:,14:17])));assert error<1e-10,error
 np.savez(R/'features.npz',X=X,early=early,coverage=coverage,sy=z['sy'],y=z['y'],dates=z['dates'],base=z['base']);print(json.dumps(dict(rows=len(meta),shape=list(X.shape),baselineRatingMaxError=error,rosterBothCoverageRecent=int(coverage[z['sy']>=2021].all(1).sum()))))
