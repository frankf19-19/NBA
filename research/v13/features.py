import json,itertools
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
NAMES=['current','rawOffDef','regressedOffDef','efficiency','efficiencyPace','combined','combinedInteractions'];RATES=np.array([.02,.04,.06]);COLS=[8,11,11,11,11,14,17]
def generate(rows,baseX,pace):
 state=np.zeros((3,2,3,31));shot=np.zeros((31,2,10));oldShot=np.zeros_like(shot);league=np.zeros(10);oldLeague=np.array([.5,1,.35,1,.75,1,0,0,0,0]);previous=None;pointPrior=100.;effPrior=105.;pointSum=0.;pointN=0;effSum=0.;possSum=0.;X=[];sideNoise=[];validPoss=[]
 for date,grp in itertools.groupby(enumerate(rows),lambda z:z[1]['d']):
  grp=list(grp);sy=grp[0][1]['sy']
  if sy!=previous:
   state*=.65
   if previous is not None:
    oldShot=shot.copy()
    if league[1]>0:oldLeague=league.copy()
    if pointN:pointPrior=pointSum/pointN
    if possSum:effPrior=100*effSum/possSum
   shot=np.zeros_like(shot);league=np.zeros(10);pointSum=0.;pointN=0;effSum=0.;possSum=0.;previous=sy
  lg=[oldLeague[0]/max(1,oldLeague[1]),oldLeague[2]/max(1,oldLeague[3]),oldLeague[4]/max(1,oldLeague[5])];delta=np.zeros_like(state);staged=[]
  for i,e in grp:
   h,a=e['hid'],e['aid'];f=np.zeros((7,17));f[:,:5]=baseX[i,[0,2,3,4,5]];f[0,5:8]=baseX[i,14:17]
   od=[np.r_[state[k,0,:,h]-state[k,0,:,a],state[k,1,:,h]-state[k,1,:,a]] for k in range(3)];scale=np.clip(pace[i],80,120)/100 if np.isfinite(pace[i]) else 1
   f[1,5:11]=od[0];f[2,5:11]=od[1];f[3,5:11]=od[2];f[4,5:11]=od[2]*scale;f[5:,5:8]=f[0,5:8];f[5:,8:14]=od[2]*scale;f[6,14:17]=(state[2,0,:,h]*state[2,1,:,a]-state[2,0,:,a]*state[2,1,:,h])/10*scale
   X.append(f);H=np.array(e['H']) if e['H'] is not None else None;A=np.array(e['A']) if e['A'] is not None else None;hn=an=0.;poss=None
   if H is not None and A is not None:
    def adjustment(tid,opp,V):
     own=shot[tid,0]+.2*oldShot[tid,0];de=shot[opp,1]+.2*oldShot[opp,1];p3=np.clip((own[2]+250*lg[1])/(own[3]+250)+.5*((de[2]+250*lg[1])/(de[3]+250)-lg[1]),.1,.95);ft=np.clip((own[4]+100*lg[2])/(own[5]+100),.1,.95);return 3*(p3*V[3]-V[2])+(ft*V[5]-V[4])
    hn=adjustment(h,a,H);an=adjustment(a,h,A);poss=(H[1]+H[3]-H[6]+H[8]+.44*H[5]+A[1]+A[3]-A[6]+A[8]+.44*A[5])/2;staged.append((h,a,H,A))
   sideNoise.append([hn,an]);valid=poss is not None and 60<poss<150;validPoss.append(valid)
   for k in range(3):
    if k==2 and not valid:continue
    obsH=e['hpts']+(.5*hn if k else 0);obsA=e['apts']+(.5*an if k else 0);center=pointPrior
    if k==2:obsH*=100/poss;obsA*=100/poss;center=effPrior
    resH=np.clip(obsH-(center+1.15+state[k,0,:,h]+state[k,1,:,a]),-25,25);resA=np.clip(obsA-(center-1.15+state[k,0,:,a]+state[k,1,:,h]),-25,25)
    delta[k,0,:,h]+=RATES*resH;delta[k,1,:,a]+=RATES*resH;delta[k,0,:,a]+=RATES*resA;delta[k,1,:,h]+=RATES*resA
  state+=delta
  for h,a,H,A in staged:
   shot[h,0]+=H;shot[h,1]+=A;shot[a,0]+=A;shot[a,1]+=H;league+=H+A
  for _,e in grp:
   pointSum+=e['hpts']+e['apts'];pointN+=2
   H,A=e['H'],e['A']
   if H is not None and A is not None:
    poss=(H[1]+H[3]-H[6]+H[8]+.44*H[5]+A[1]+A[3]-A[6]+A[8]+.44*A[5])/2
    if 60<poss<150:effSum+=e['hpts']+e['apts'];possSum+=2*poss
 return np.array(X),np.array(sideNoise),np.array(validPoss)
if __name__=='__main__':
 rows=json.loads((R/'source.json').read_text(encoding='utf-8'));ref=json.loads((R.parent/'v7/clean-meta.json').read_text());assert [e['id'] for e in rows]==[e['id'] for e in ref];z=np.load(R.parent/'v7/clean-reference.npz');pace=np.load(R.parent/'v12/features.npz')['detail'][:,0];X,noise,valid=generate(rows,z['X'],pace);old=json.loads((R.parent/'v11/source.json').read_text(encoding='utf-8'));error=float(abs(noise[:,0]-noise[:,1]-old['noise']).max());assert error<1e-10,error
 np.savez(R/'features.npz',X=X,sideNoise=noise,validPoss=valid);print(json.dumps(dict(rows=len(rows),shape=list(X.shape),shootingAdjustmentMaxError=error,validPoss=int(valid.sum()))))
