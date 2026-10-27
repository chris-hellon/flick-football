#!/usr/bin/env bash
# One-time setup of the Flick Football app on the droplet. Run as root (deploy.sh --setup does
# this over SSH). The website itself (Nginx site, HTTPS, DNS) is made in Orbit as a reverse proxy
# to the same port; this script never touches Nginx or anything else on the droplet. It adds only:
#   - a system user `flickfootball` that runs the app
#   - /var/www/flick-football, owned by the deploying user so deploys need no sudo
#   - /etc/systemd/system/flick-football.service
#   - /etc/sudoers.d/flick-football: lets the deploying user restart this one service
# Re-running it is safe: it brings these back to the versions in this folder.
#
# Usage: setup-droplet.sh <port> <deploying user>
set -euo pipefail

PORT="${1:?port for the app on 127.0.0.1, e.g. 5080}"
OWNER="${2:?the SSH user that deploys}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/var/www/flick-football
SERVICE=flick-football
APP_USER=flickfootball

fail() { echo "setup: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail "run as root (sudo)"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || fail "port must be 1024-65535"
id "$OWNER" >/dev/null 2>&1 || fail "no user '$OWNER'"
for tool in systemctl rsync; do command -v "$tool" >/dev/null || fail "$tool isn't installed"; done

# The port must be free, unless it's this app already listening on it.
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet "$SERVICE"; then
  fail "something already listens on port $PORT; pick another (FLICK_PORT=...)"
fi

echo "== user and folder"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$OWNER" -g "$APP_USER" -m 2755 "$APP_DIR"

echo "== systemd service"
sed "s/__PORT__/$PORT/g" "$HERE/flick-football.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

# root can restart it anyway; anyone else gets a rule for just this service.
if [[ "$OWNER" != root ]]; then
  echo "== sudo rule: $OWNER may restart $SERVICE"
  SYSTEMCTL="$(command -v systemctl)"
  RULE="/etc/sudoers.d/$SERVICE"
  printf '%s ALL=(root) NOPASSWD: %s restart %s, %s status %s\n' \
    "$OWNER" "$SYSTEMCTL" "$SERVICE" "$SYSTEMCTL" "$SERVICE" > "$RULE.tmp"
  chmod 440 "$RULE.tmp"
  visudo -cf "$RULE.tmp" >/dev/null || { rm -f "$RULE.tmp"; fail "sudo rule didn't validate"; }
  mv "$RULE.tmp" "$RULE"
fi

echo "== .NET"
if command -v dotnet >/dev/null && dotnet --list-runtimes 2>/dev/null | grep -q "^Microsoft.AspNetCore.App 10\."; then
  echo "   ASP.NET Core 10 runtime found: deploy normally"
else
  echo "   No ASP.NET Core 10 runtime: deploy with SELF_CONTAINED=1 (or install aspnetcore-runtime-10.0)"
fi

[[ -x "$APP_DIR/FlickFootball.Server" ]] && systemctl restart "$SERVICE"

cat <<DONE

Done. Next:
  1. In Orbit: add the website as a reverse proxy to port $PORT, then enable HTTPS.
  2. Deploy from your machine:  FLICK_SSH=$OWNER@<droplet> deploy/deploy.sh
DONE
