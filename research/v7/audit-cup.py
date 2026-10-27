import json,urllib.request,concurrent.futures
from pathlib import Path
R=Path('research/v7');ids=['401607494','401607493','401607495','401734906','401734907','401734908','401809837','401809838','401809839']
def get(gid):
 url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+gid
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'NBA-model-research'}),timeout=30) as f:o=json.load(f)
 h=o.get('header',{});c=h.get('competitions',[{}])[0];return dict(id=gid,url=url,neutralSite=c.get('neutralSite'),notes=c.get('notes'),type=c.get('type'),season=h.get('season'),groups=c.get('groups'),name=h.get('name'))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:a=list(p.map(get,ids))
(R/'cup-context-audit.json').write_text(json.dumps(a,indent=2));print(json.dumps(a,indent=2))
