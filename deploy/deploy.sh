#!/usr/bin/env bash
# Builds, tests and deploys Flick Football to the droplet. Run from anywhere in the repo.
#
#   FLICK_SSH=chris@droplet deploy/deploy.sh           # deploy
#   FLICK_SSH=chris@droplet deploy/deploy.sh --setup   # first time: set up the service, then deploy
#
# The website (Nginx reverse proxy to FLICK_PORT, HTTPS, DNS) is made in Orbit, not here.
#
# Settings (environment):
#   FLICK_SSH        required: SSH destination, user@host (the user that owns the app folder)
#   FLICK_PORT       port on the droplet's loopback (default 5080); must match the setup
#   FLICK_HOST       public host name; when set, the HTTPS health check runs at the end
#   SELF_CONTAINED   1 to bundle the .NET runtime (if the droplet doesn't have ASP.NET Core 10)
#   FLICK_RID        runtime to publish for (default linux-x64; linux-arm64 for an ARM server)
#   SKIP_TESTS       1 to skip lint and tests
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/out"
APP_DIR=/var/www/flick-football
SSH_TO="${FLICK_SSH:?set FLICK_SSH=user@droplet}"
PORT="${FLICK_PORT:-5080}"
RID="${FLICK_RID:-linux-x64}"
SC="$([[ "${SELF_CONTAINED:-0}" == 1 ]] && echo true || echo false)"
SETUP=0
[[ "${1:-}" == "--setup" ]] && SETUP=1
step() { printf '\n== %s\n' "$*"; }

cd "$ROOT"
step "client: install, lint, test, build"
[[ -d src/client/node_modules ]] || npm --prefix src/client ci
if [[ "${SKIP_TESTS:-0}" != 1 ]]; then
  npm --prefix src/client run -s lint
  npm --prefix src/client run -s test
fi
npm --prefix src/client run -s build

if [[ "${SKIP_TESTS:-0}" != 1 ]]; then
  step "server: tests"
  dotnet test --nologo -v q
fi

step "server: publish for $RID (self-contained: $SC)"
rm -rf "$OUT"
dotnet publish src/FlickFootball.Server -c Release -r "$RID" --self-contained "$SC" \
  -p:DebugType=none -o "$OUT" --nologo -v q
[[ -f "$OUT/wwwroot/index.html" ]] || { echo "the client build is missing from the publish" >&2; exit 1; }

if [[ $SETUP == 1 ]]; then
  step "droplet: one-time setup (service on port $PORT)"
  ssh "$SSH_TO" 'mkdir -p ~/flick-football-setup'
  rsync -a deploy/setup-droplet.sh deploy/flick-football.service "$SSH_TO:flick-football-setup/"
  ssh -t "$SSH_TO" "sudo bash ~/flick-football-setup/setup-droplet.sh '$PORT' \"\$(whoami)\""
fi

step "droplet: upload"
rsync -az --delete --no-owner --no-group --chmod=Dg+rx,Fg+r "$OUT/" "$SSH_TO:$APP_DIR/"

step "droplet: restart"
ssh "$SSH_TO" "sudo systemctl restart flick-football"
for i in $(seq 1 20); do
  if ssh "$SSH_TO" "curl -fsS http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "running"
    break
  fi
  [[ $i == 20 ]] && { ssh "$SSH_TO" "sudo systemctl status flick-football --no-pager" || true; echo "didn't come up" >&2; exit 1; }
  sleep 1
done

if [[ -n "${FLICK_HOST:-}" ]]; then
  step "public check: https://$FLICK_HOST"
  if curl -fsS "https://$FLICK_HOST/healthz" >/dev/null; then
    echo "https://$FLICK_HOST is up"
  else
    echo "https://$FLICK_HOST isn't answering yet (is the Orbit site set up, with HTTPS?)"
  fi
fi
