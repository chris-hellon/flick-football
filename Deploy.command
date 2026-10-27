#!/bin/bash
# Double-click in Finder to put the current code live at flickfootball.com.
# Runs deploy/deploy.sh with the settings in deploy/deploy.env: tests, build, upload, restart, check.
cd "$(dirname "$0")" || exit 1

# Finder starts this without your shell setup, so find Node (nvm) and .NET.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/share/dotnet:$PATH"

clear
echo "Deploying Flick Football…"
echo
start=$(date +%s)
if deploy/deploy.sh; then
  echo
  echo "✅ Live at https://flickfootball.com ($(( $(date +%s) - start ))s)"
  osascript -e 'display notification "Live at flickfootball.com" with title "Flick Football deployed" sound name "Glass"' >/dev/null 2>&1
  status=0
else
  echo
  echo "❌ Deploy failed: nothing changed on the live site unless it got as far as \"droplet: upload\". See above."
  osascript -e 'display notification "See the Terminal window" with title "Flick Football deploy failed" sound name "Basso"' >/dev/null 2>&1
  status=1
fi
echo
read -r -n 1 -s -p "Press any key to close."
echo
exit $status
