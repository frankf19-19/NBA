/* 資料源探測:在 GitHub Actions 上實際試連候選 API,印出狀態、大小與重點欄位(只讀不寫) */
const T=[
 ['NBA cdn 今日賽程','https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json'],
 ['NBA cdn 全季賽程','https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json'],
 ['NBA cdn 單場 boxscore(2025-26 例)','https://cdn.nba.com/static/json/liveData/boxscore/boxscore_0022500001.json'],
 ['NBA cdn 單場 playbyplay','https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_0022500001.json'],
 ['NBA stats.nba.com(預期被擋)','https://stats.nba.com/stats/leaguedashteamstats?Season=2025-26&SeasonType=Regular%20Season&MeasureType=Advanced'],
 ['NBA 官方裁判派遣','https://official.nba.com/referee-assignments/'],
 ['NBA 官方傷兵報告 PDF 目錄','https://official.nba.com/nba-injury-report-2025-26-season/'],
 ['ESPN core 單場賠率(多家)','https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/odds'],
 ['ESPN core 單場 predictor(BPI)','https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/predictor'],
 ['ESPN core 球隊季統計','https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/teams/13/statistics'],
 ['ESPN core 球員季統計','https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/athletes/3975/statistics'],
 ['ESPN 球員 splits','https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/3975/splits?season=2026'],
 ['ESPN 球員 gamelog','https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/3975/gamelog?season=2026'],
 ['ESPN 交易/異動','https://site.api.espn.com/apis/site/v2/sports/basketball/nba/transactions?limit=50'],
 ['ESPN powerindex(BPI 排名)','https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/powerindex'],
 ['ESPN 單場 odds 歷史(line movement)','https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/odds/100/history/0/movement?limit=100'],
 ['Basketball-Reference(ToS 限制,只測可達)','https://www.basketball-reference.com/leagues/NBA_2026_games.html'],
 ['balldontlie API','https://api.balldontlie.io/v1/teams'],
];
(async()=>{for(const [n,u] of T){const t0=Date.now();try{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0 (nba-scoreboard-probe)','Accept':'application/json,text/html'},signal:AbortSignal.timeout(20000)});
  const txt=await r.text();let keys='';try{const j=JSON.parse(txt);keys=Array.isArray(j)?`array[${j.length}]`:Object.keys(j).slice(0,12).join(',');}catch(e){keys='(HTML/text) '+txt.replace(/\s+/g,' ').slice(0,80);}
  console.log(`${r.ok?'✅':'❌'} ${r.status} ${String(Date.now()-t0).padStart(5)}ms ${String(txt.length).padStart(8)}B  ${n}\n      ${keys}`);}
  catch(e){console.log(`❌ ERR ${n}: ${e.message}`);}}})();
