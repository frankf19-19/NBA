import json,itertools,datetime,math,collections
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
R=Path(__file__).resolve().parent
# Approximate metro centers rounded to 0.1 degree: geographic modeling inputs.
C={
'Atlanta':(33.8,-84.4,'America/New_York'),'Boston':(42.4,-71.1,'America/New_York'),'Charlotte':(35.2,-80.8,'America/New_York'),'Chicago':(41.9,-87.6,'America/Chicago'),'Cleveland':(41.5,-81.7,'America/New_York'),'Dallas':(32.8,-96.8,'America/Chicago'),'Denver':(39.7,-105.0,'America/Denver'),'Detroit':(42.3,-83.0,'America/Detroit'),'Oakland':(37.8,-122.3,'America/Los_Angeles'),'SanFrancisco':(37.8,-122.4,'America/Los_Angeles'),'Houston':(29.8,-95.4,'America/Chicago'),'Indianapolis':(39.8,-86.2,'America/Indiana/Indianapolis'),'LosAngeles':(34.1,-118.3,'America/Los_Angeles'),'Miami':(25.8,-80.2,'America/New_York'),'Milwaukee':(43.0,-87.9,'America/Chicago'),'Minneapolis':(45.0,-93.3,'America/Chicago'),'Brooklyn':(40.7,-74.0,'America/New_York'),'NewJersey':(40.8,-74.1,'America/New_York'),'NewYork':(40.8,-74.0,'America/New_York'),'Orlando':(28.5,-81.4,'America/New_York'),'Philadelphia':(40.0,-75.2,'America/New_York'),'Phoenix':(33.4,-112.1,'America/Phoenix'),'Portland':(45.5,-122.7,'America/Los_Angeles'),'Sacramento':(38.6,-121.5,'America/Los_Angeles'),'SanAntonio':(29.4,-98.5,'America/Chicago'),'Austin':(30.3,-97.7,'America/Chicago'),'Seattle':(47.6,-122.3,'America/Los_Angeles'),'OklahomaCity':(35.5,-97.5,'America/Chicago'),'Toronto':(43.7,-79.4,'America/Toronto'),'Tampa':(28.0,-82.5,'America/New_York'),'Utah':(40.8,-111.9,'America/Denver'),'Memphis':(35.1,-90.1,'America/Chicago'),'Vancouver':(49.3,-123.1,'America/Vancouver'),'NewOrleans':(30.0,-90.1,'America/Chicago'),'Washington':(38.9,-77.0,'America/New_York')}
VEN={
'State Farm Arena':'Atlanta','TD Garden':'Boston','Spectrum Center':'Charlotte','Charlotte Coliseum':'Charlotte','United Center':'Chicago','Rocket Arena':'Cleveland','American Airlines Center':'Dallas','Ball Arena':'Denver','The Palace of Auburn Hills':'Detroit','Little Caesars Arena':'Detroit','Oracle Arena':'Oakland','Chase Center':'SanFrancisco','Toyota Center (Houston)':'Houston','Gainbridge Fieldhouse':'Indianapolis','crypto.com Arena':'LosAngeles','Intuit Dome':'LosAngeles','Kaseya Center':'Miami','BMO Harris Bradley Center':'Milwaukee','Fiserv Forum':'Milwaukee','UW-Milwaukee Panther Arena':'Milwaukee','Target Center':'Minneapolis','Barclays Center':'Brooklyn','IZOD Center':'NewJersey','Prudential Center':'NewJersey','Madison Square Garden':'NewYork','Kia Center':'Orlando','Amway Arena':'Orlando','Xfinity Mobile Arena':'Philadelphia','Mortgage Matchup Center':'Phoenix','Moda Center':'Portland','Sleep Train Arena':'Sacramento','Golden 1 Center':'Sacramento','Frost Bank Center':'SanAntonio','Alamodome':'SanAntonio','Moody Center':'Austin','KeyArena':'Seattle','Paycom Center':'OklahomaCity','Scotiabank Arena':'Toronto','Benchmark International Arena':'Tampa','Amalie Arena':'Tampa','Delta Center':'Utah','FedExForum':'Memphis','Smoothie King Center':'NewOrleans','Capital One Arena':'Washington'}
VEN={k.strip().lower():v for k,v in VEN.items()}
def site(e):return VEN.get(str(e.get('ven') or '').strip().lower())
def home_ok(e,city):
 n=e.get('hm','').replace(' ','').lower()
 if e['hid']==28 and city=='Tampa':return e.get('sy')==2021
 if e['hid']==24 and city=='Austin':return True
 if e['hid']==3 and 'oklahoma' in n:return city in ['NewOrleans','OklahomaCity']
 if e['hid']==9:return city in ['Oakland','SanFrancisco']
 if e['hid']==17:return city in (['NewJersey'] if 'newjersey' in n else ['Brooklyn'])
 return n.startswith(city.lower()) or (city=='Utah' and n.startswith('utah')) or (city=='LosAngeles' and n.startswith('la')) or (city=='Minneapolis' and n.startswith('minnesota'))
def km(a,b):
 lat1,lon1,*_=C[a];lat2,lon2,*_=C[b];r=math.pi/180;v=math.sin((lat2-lat1)*r/2)**2+math.cos(lat1*r)*math.cos(lat2*r)*math.sin((lon2-lon1)*r/2)**2;return 6371*2*math.asin(math.sqrt(min(1,v)))
def offset(city,when):return when.astimezone(ZoneInfo(C[city][2])).utcoffset().total_seconds()/3600
def load():
 out=[];seen=set()
 for file in sorted((R.parent/'data/seed').glob('ledger-*.json')):
  sy=int(file.stem.split('-')[1])
  if sy>2026:continue
  for e in json.loads(file.read_text(encoding='utf-8')):
   if e.get('id') in seen or not e.get('am') or not e.get('tip'):continue
   seen.add(e['id']);out.append({**{k:e[k] for k in ['id','d','hid','aid','hm','aw','ven','tip','ls','am'] if k in e},'sy':e.get('sy',sy)})
 return sorted(out,key=lambda e:(e['d'],str(e['id'])))
def build(rows,meta):
 ids={e['id']:i for i,e in enumerate(meta)};F=np.zeros((len(meta),21));valid=np.zeros(len(meta),bool);history=collections.defaultdict(list);prev=None;audit=collections.Counter()
 for d,g in itertools.groupby(rows,lambda e:e['d']):
  g=list(g);sy=g[0].get('sy');day=datetime.date.fromisoformat(d)
  if sy!=prev:history=collections.defaultdict(list);prev=sy
  for e in g:
   if e['id'] not in ids:continue
   i=ids[e['id']];city=site(e);audit['target']+=1
   if not city or not home_ok(e,city):audit['unknownOrAtypicalSite']+=1;continue
   when=datetime.datetime.fromisoformat(e['tip'].replace('Z','+00:00'));v=[];okay=True
   for tid in [e['hid'],e['aid']]:
    past=history[tid]
    if not past or not past[-1]['site']:okay=False;break
    last=past[-1];gap=(day-last['day']).days;hours=(when-last['tip']).total_seconds()/3600
    if gap<=0 or hours<=0:okay=False;break
    dist=km(last['site'],city) if gap<=7 else 0;tz=offset(city,when)-offset(last['site'],when) if gap<=7 else 0;home=e['hid']==tid
    road=0 if home else min(8,(last['road'] if gap<=7 else 0)+1);coming=float(home and not last['home'] and gap<=7)
    v.append(dict(gap=gap,hours=hours,ot=last['ot'],dist=dist,tz=tz,road=road,coming=coming,g7=sum(0<(day-x['day']).days<=7 for x in past),g14=sum(0<(day-x['day']).days<=14 for x in past),rise=float(city in ['Denver','Utah'] and last['site'] not in ['Denver','Utah'])))
   if not okay:audit['missingPreviousSiteOrTip']+=1;continue
   H,A=v
   def diff(fn):return fn(H)-fn(A)
   den=float(city=='Denver' and e['hid']==7);ut=float(city=='Utah' and e['hid']==26)
   F[i]=[diff(lambda t:min(7,t['gap'])),diff(lambda t:min(168,t['hours'])/24),diff(lambda t:t['ot']/t['gap'] if t['gap']<=3 else 0),diff(lambda t:t['ot'] if t['gap']==1 else 0),diff(lambda t:t['g7']),diff(lambda t:t['g14']),diff(lambda t:t['road']),diff(lambda t:t['coming']),diff(lambda t:t['dist']/1000),diff(lambda t:t['dist']/1000/t['gap']),diff(lambda t:max(t['tz'],0)),diff(lambda t:max(-t['tz'],0)),diff(lambda t:abs(t['tz'])),diff(lambda t:float(t['hours']<22)),diff(lambda t:abs(t['tz'])/t['gap']),den,ut,A['rise']/(A['gap']+1)-H['rise']/(H['gap']+1),den*float(A['gap']==1),ut*float(A['gap']==1),diff(lambda t:t['dist']/1000 if t['gap']==1 else 0)]
   valid[i]=True;audit['eligible']+=1
  for e in g:
   city=site(e);when=datetime.datetime.fromisoformat(e['tip'].replace('Z','+00:00'));ls=e.get('ls') or {};periods=max([len(x) for x in ls.values() if isinstance(x,list)],default=4);ot=max(0,min(6,periods-4))
   for tid in [e['hid'],e['aid']]:
    past=history[tid];home=tid==e['hid'];gap=(day-past[-1]['day']).days if past else 99;road=0 if home else (past[-1]['road'] if past and gap<=7 else 0)+1
    past.append(dict(day=day,tip=when,site=city,home=home,road=road,ot=ot));history[tid]=past[-20:]
 return F,valid,audit
if __name__=='__main__':
 rows=load();meta=json.loads((R.parent/'v2/meta.json').read_text());F,valid,audit=build(rows,meta);np.savez(R/'features.npz',X=F,valid=valid);(R/'geography.json').write_text(json.dumps({'cities':C,'venues':VEN},indent=2));(R/'audit.json').write_text(json.dumps(dict(audit),indent=2));print('FEATURES',F.shape,dict(audit),flush=True)
 prefix=[e for e in rows if e['d']<='2026-03-05'];changed=[{**e,'ls':{'h':[1]*8,'a':[1]*8},'am':150} if e['d']>='2026-03-01' else e for e in prefix];a,va,_=build(prefix,meta);b,vb,_=build(changed,meta);before=np.array([e['d']<='2026-03-01' for e in meta]);assert np.array_equal(a[before],b[before]);assert np.array_equal(va[before],vb[before]);assert not np.array_equal(a[~before],b[~before]);print('CAUSALITY passed',flush=True)
