import json,re,unicodedata,datetime,collections,itertools
from pathlib import Path
import numpy as np
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--perturb-from');parser.add_argument('--output',default='features.json');args=parser.parse_args()
R=Path(__file__).resolve().parent
meta=json.loads((R.parent/'v7/clean-meta.json').read_text());idx={e['id']:i for i,e in enumerate(meta)};base=np.load(R.parent/'v7/clean-reference.npz')['base'];coeff=json.loads((R/'player-coefficients.json').read_text())
def norm(s):
 s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower();s=re.sub(r'\b(jr|sr|ii|iii|iv)\b','',s);return re.sub('[^a-z]','',s)
def pname(s):
 p=s.split(',');return norm(p[1]+' '+p[0]+(' '+p[2] if len(p)>2 else '')) if len(p)>1 else norm(s)
names=json.loads((R.parent/'v3/athlete-names.json').read_text());aliases=collections.defaultdict(set)
for pid,e in names.items():
 for n in e.get('names',[]):aliases[norm(n)].add(int(pid))
# Exact known spelling variants, identity only (no performance information).
for a,b in [('Nic Claxton','Nicolas Claxton'),('Nicolas Claxton','Nic Claxton'),('Kenyon Martin','KJ Martin'),('KJ Martin','Kenyon Martin')]:
 if norm(b) in aliases:aliases[norm(a)]|=aliases[norm(b)]
games=[];teams={}
for sy in range(2019,2027):
 for e in json.loads((R.parent/f'data/seed/ledger-{sy}.json').read_text(encoding='utf-8')):
  if e.get('po') or e.get('st')==1 or not e.get('am') or e['id'] in ['401607495','401734908','401809839']:continue
  games.append(e);teams[norm(e['hm'])]=e['hid'];teams[norm(e['aw'])]=e['aid']
teams[norm('Los Angeles Clippers')]=teams[norm('LA Clippers')]
if args.perturb_from:
 games=[{**e,'pl':{side:[{**p,'pts':200,'min':48} if p.get('id') is not None and p.get('min',0)>0 else p for p in e.get('pl',{}).get(side,[])] for side in ['h','a']}} if e['d']>=args.perturb_from else e for e in games]
reports=json.loads((R.parent/'v3/injury-reports.json').read_text(encoding='utf-8'));bydate={e['date']:e for e in reports if 'teams' in e};audit=collections.Counter();unknown=collections.Counter();rows=[];season=None;hist={};prev={};tg=collections.Counter();recent=collections.defaultdict(list)
for date,group in itertools.groupby(sorted(games,key=lambda e:(e['d'],e['id'])),lambda e:e['d']):
 group=list(group);sy=group[0]['sy']
 if sy!=season:prev=hist;hist={};tg=collections.Counter();recent=collections.defaultdict(list);allgames=collections.defaultdict(list);season=sy
 for e in group:
  if sy<2021 or e['id'] not in idx:continue
  audit['games']+=1;r=bydate.get(date)
  if not r:audit['missingReport']+=1;continue
  if not e.get('tip'):audit['missingTip']+=1;continue
  published=datetime.datetime.fromisoformat(r['published']);tip=datetime.datetime.fromisoformat(e['tip'].replace('Z','+00:00'))
  if published>=tip:audit['afterTip']+=1;continue
  parts={teams.get(norm(t['team'])):t for t in r['teams'] if t['gameDate']==date and teams.get(norm(t['team'])) in [e['hid'],e['aid']]}
  if any(t not in parts for t in [e['hid'],e['aid']]):audit['missingTeam']+=1;continue
  if not all(t['submitted'] for t in parts.values()):audit['unsubmitted']+=1;continue
  f=np.zeros((2,3));miss=0;pfeatures=[]
  for side,(tid,sign) in enumerate([(e['hid'],-1),(e['aid'],1)]):
   for p in parts[tid]['players']:
    found=aliases.get(pname(p['name']),set())
    if len(found)!=1:unknown[p['name']]+=1;miss+=1;continue
    pid=next(iter(found));g,pts,mins=hist.get(pid,(0,0,0));pg,pp,pm=prev.get(pid,(0,0,0));ppg=pts/g if g>=5 else pp/pg if pg>=8 else 0;mpg=mins/g if g>=5 else pm/pg if pg>=8 else 0;impact=coeff[str(sy)].get(str(pid),0)*min(48,mpg)/48
    if not ppg:continue
    att=sum(pid in x for x in recent[tid])/max(1,len(recent[tid]));own=sum(pid in x for x in allgames.get(tid,[]))/max(1,tg[tid]) if tg[tid] else 0
    attendance=.65*own+.35*att if tg[tid]>=5 else 1
    w={'Out':1,'Doubtful':.75,'Questionable':.4,'Probable':.1,'Available':0}[p['status']]
    pfeatures.append({'pid':pid,'side':side,'status':p['status'],'ppg':ppg,'mpg':mpg});f[side,0]+=ppg*w if ppg>=6 else 0;f[side,1]+=impact*w;f[side,2]+=impact*(attendance-(1-w))
  # Missing identities are excluded, not silently counted as healthy/zero.
  if miss:audit['unresolvedIdentity']+=1;continue
  rows.append({'i':idx[e['id']],'id':e['id'],'d':date,'sy':sy,'y':e['am'],'base':float(base[idx[e['id']]]),'x':f.tolist(),'players':pfeatures,'appearanceLabels':[int(any(pl.get('id') is not None and int(pl['id'])==p['pid'] for pl in e.get('pl',{}).get('h' if p['side']==0 else 'a',[]))) for p in pfeatures],'boxKnown':all(e.get('pl',{}).get(side) for side in ['h','a']),'ageHours':(tip-published).total_seconds()/3600,'report':r['file']});audit['eligible']+=1
 for e in group:
  for side,tid in [('h',e['hid']),('a',e['aid'])]:
   pls=[p for p in e.get('pl',{}).get(side,[]) if p.get('id') is not None and int(p['id'])>0];ids={int(p['id']) for p in pls};tg[tid]+=1;recent[tid].append(ids);recent[tid]=recent[tid][-10:];allgames[tid].append(ids)
   for p in pls:
    pid=int(p['id']);g,pt,mi=hist.get(pid,(0,0,0));hist[pid]=(g+1,pt+p.get('pts',0),mi+p.get('min',0))
(R/args.output).write_text(json.dumps({'audit':dict(audit),'unknown':unknown,'rows':rows},ensure_ascii=False),encoding='utf-8');print('AUDIT',audit);print('UNKNOWN',unknown.most_common(35));print('BY YEAR',collections.Counter(e['sy'] for e in rows))
