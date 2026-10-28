import json,itertools
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
NAMES=['proxy','affine','series','teamForm','seriesAndTeam','regularQuality'];COLS=[[0,1],[0,1,2,3],[0,1,4],[0,1,2,3,4]]
def fit(x,y,ridge=20):
 scale=x.std(0);scale[scale<1e-6]=1;a=x/scale;pen=np.eye(x.shape[1])*ridge;pen[0,0]=1e-8;return np.linalg.solve(a.T@a+pen,a.T@y)/scale
def metrics(mask,p,y):
 t=y[mask];v=p[mask];return dict(n=int(mask.sum()),mae=float(abs(t-v).mean()),rmse=float(np.sqrt(((t-v)**2).mean())),winner=float(((t>0)==(v>=0)).mean()))
def series_features(rows):
 history={};team={};out=[];number=[];keys=[]
 for d,group in itertools.groupby(rows,lambda e:e['d']):
  group=list(group)
  for e in group:
   h,a=e['hid'],e['aid'];key=str(e['sy'])+'|'+str(min(h,a))+'|'+str(max(h,a));sign=1 if h<a else -1;values=history.get(key,[]);hh=team.get((e['sy'],h),[]);aa=team.get((e['sy'],a),[])
   out.append([1,e['proxy'],sign*sum(values)/(len(values)+3),sign*values[-1] if values else 0,sum(hh)/(len(hh)+5)-sum(aa)/(len(aa)+5)]);number.append(len(values));keys.append(key)
  for e in group:
   key=str(e['sy'])+'|'+str(min(e['hid'],e['aid']))+'|'+str(max(e['hid'],e['aid']));res=e['y']-e['proxy'];history.setdefault(key,[]).append(res*(1 if e['hid']<e['aid'] else -1));team.setdefault((e['sy'],e['hid']),[]).append(res/2);team.setdefault((e['sy'],e['aid']),[]).append(-res/2)
 return np.array(out),np.array(number),np.array(keys)
def ci(mask,p,b,y,keys):
 groups=sorted(set(keys[mask]));delta=abs(y-p)-abs(y-b);sums=np.array([delta[(keys==g)&mask].sum() for g in groups]);ns=np.array([((keys==g)&mask).sum() for g in groups]);ix=np.random.default_rng(20261028).integers(0,len(groups),(5000,len(groups)));return np.quantile(sums[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist()
if __name__=='__main__':
 source=json.loads((R/'source.json').read_text(encoding='utf-8'));rows=source['rows'];z=np.load(R/'features.npz');allX=z['X'];reg=z['regular'];sy=np.array([e['sy'] for e in rows]);yy=np.array([e['y'] for e in rows]);take=np.array([not e['reg'] and e['proxy'] is not None and e['sy']>=2005 for e in rows]);po=[e for e,t in zip(rows,take) if t];s=sy[take];y=yy[take];proxy=np.array([e['proxy'] for e in po]);F,number,keys=series_features(po);P=np.tile(proxy[:,None],(1,6));seasons=sorted(set(s));training=[]
 for season in seasons:
  prior=[v for v in seasons if v<season];trainSeasons=prior[-4:];tr=np.isin(s,trainSeasons);te=s==season
  if tr.sum()>=200:
   for k,cols in enumerate(COLS,1):P[te,k]=proxy[te]+F[te][:,cols]@fit(F[tr][:,cols],y[tr]-proxy[tr])
  rtr=reg&(sy>=season-4)&(sy<season);P[te,5]=allX[take][te]@fit(allX[rtr],yy[rtr],10);training.append(dict(season=int(season),playoffTrainingSeasons=[int(v) for v in trainSeasons],playoffTrainN=int(tr.sum())))
 selected=proxy.copy();folds=[]
 for season in seasons:
  if season<2015:continue
  prior=[v for v in seasons if v<season][-3:];val=np.isin(s,prior);te=s==season;ms=[metrics(val,P[:,k],y) for k in range(6)];b=ms[0];eligible=[k for k in range(1,6) if val.sum()>=200 and ms[k]['mae']<=b['mae']-.05 and ms[k]['rmse']<=b['rmse']+.02 and ms[k]['winner']>=b['winner']-.01];best=min((ms[k]['mae'] for k in eligible),default=0);choice=next((k for k in eligible if ms[k]['mae']<=best+.02),0);selected[te]=P[te,choice];folds.append(dict(season=int(season),choice=NAMES[choice],validationSeasons=[int(v) for v in prior],validationN=int(val.sum()),baseline=metrics(te,proxy,y),selected=metrics(te,selected,y),all={n:metrics(te,P[:,k],y) for k,n in enumerate(NAMES)}))
 mask=s>=2021;b=metrics(mask,proxy,y);a=metrics(mask,selected,y);interval=ci(mask,selected,proxy,y,keys);improved=sum(f['selected']['mae']<f['baseline']['mae'] for f in folds if f['season']>=2021);out=dict(names=NAMES,scope='Non-neutral ESPN type3 full playoffs only; historical incumbent proxy, not actual frozen website/injury forecasts; repeated retrospective research',training=training,folds=folds,recent=dict(baseline=b,selected=a,all={n:metrics(mask,P[:,k],y) for k,n in enumerate(NAMES)},series=int(len(set(keys[mask]))),maeDifferenceSeriesCI95=interval,improvedYears=improved,firstGame=dict(baseline=metrics(mask&(number==0),proxy,y),selected=metrics(mask&(number==0),selected,y)),laterGames=dict(baseline=metrics(mask&(number>0),proxy,y),selected=metrics(mask&(number>0),selected,y))),gate=bool(a['mae']<=b['mae']-.1 and a['rmse']<=b['rmse'] and a['winner']>=b['winner'] and improved>=4 and interval[1]<0));(R/'results.json').write_text(json.dumps(out,indent=2));np.savez(R/'predictions.npz',P=P,selected=selected,y=y,sy=s,keys=keys,number=number,features=F);print(json.dumps(dict(recent=out['recent'],gate=out['gate'],choices=[(f['season'],f['choice']) for f in folds]),indent=2))
