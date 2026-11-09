#!/usr/bin/env bash
# 臨場循環(GitHub 排程常延遲或被略過,所以改成一次跑約 5.7 小時、每 10 分鐘檢查一次):
# 1) 抓 NBA 官方最新傷兵報告;2) 有比賽將開打且預測過舊時,快速重算(NBA_FAST_REFRESH=1)並提交。
set -u
END=$(( $(date +%s) + ${LOOP_MINUTES:-340}*60 ))
git config user.name "neartip-bot"; git config user.email "actions@users.noreply.github.com"
calib_running(){ gh api "repos/$GITHUB_REPOSITORY/actions/workflows/calib.yml/runs?status=in_progress&per_page=1" --jq '.total_count' 2>/dev/null || echo 0; }
push_it(){ # $1 = 訊息
  git diff --cached --quiet && return 0
  git commit -qm "$1"
  for i in 1 2 3; do
    if git pull -q --rebase origin main; then git push -q && return 0; else git rebase --abort 2>/dev/null; fi
    sleep 7
  done
  echo "提交失敗(與其他排程衝突),下一輪再試"; git reset -q --hard origin/main
}
while [ "$(date +%s)" -lt "$END" ]; do
  git fetch -q origin main && git reset -q --hard origin/main
  node scripts/injury-latest.cjs
  git add injury-latest.json 2>/dev/null; push_it "官方傷兵報告更新 $(date -u +%FT%H:%MZ)"
  if [ "$(node scripts/near-tip-due.cjs)" = "1" ]; then
    if [ "$(calib_running)" != "0" ]; then echo "完整校準執行中,這輪跳過重算";
    else
      NBA_FAST_REFRESH=1 timeout 15m node scripts/calib.js > /tmp/calib.log 2>&1; echo "重算結束 code=$?"; tail -5 /tmp/calib.log
      git add -A calib.json pdb.json margin-model.json quality-model.json robust-shadow.json availability-shadow.json bin-shadow.json forecast-audit.json pregame-timing-audit.json role-study-audit.json model-guard.json player-model.json seed injury-latest.json 2>/dev/null
      git add -u; push_it "臨場重算(開打前) $(date -u +%FT%H:%MZ)"
    fi
  fi
  sleep 600
done
