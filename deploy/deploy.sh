#!/bin/sh
# Ship Chorus to Jinx. The box keeps its own checkout at /opt/apps/Chorus, so
# the unit of deployment is a fast-forward of that checkout, a rebuild in
# place and a restart of the `chorus` systemd unit. The code is not copied
# from here, which is what makes a deploy from CI and a deploy from a laptop
# the same operation; only deploy/chorus.service and deploy/chorus.caddy go
# over from this tree.
#
# --ff-only rather than a plain pull: if the checkout on the box has drifted,
# stop and say so rather than quietly merging something nobody wrote.
#
# Re-runnable, and the first run on an empty box sets everything up: the
# clone, the unit, the site block and /etc/apps/chorus.env (session secrets
# generated on the box, DATABASE_URL from jinx/bootstrap.sh). Dev dependencies
# are pruned once the build is done. The public hostname is a Cloudflare
# dashboard step: Zero Trust > Tunnels > Public Hostname, chorusify.com ->
# http://localhost:80.
set -eu
cd "$(dirname "$0")/.."
HOST=${HOST:-ssh.futile.studio}
NAME=chorus
SITE=chorusify.com

scp -q deploy/chorus.caddy deploy/$NAME.service "$HOST":/tmp/
ssh "$HOST" "NAME=$NAME SITE=$SITE sh -s" <<'BOX'
set -eu
ENV=/etc/apps/$NAME.env
sudo -n touch "$ENV" && sudo -n chmod 600 "$ENV"
# Add a key only when it is missing, so a rerun never rotates a secret.
add() { sudo -n grep -q "^$1=" "$ENV" || echo "$1=$2" | sudo -n tee -a "$ENV" >/dev/null; }
add SESSION_SECRET "$(openssl rand -hex 32)"
add CSRF_SECRET "$(openssl rand -hex 32)"
sudo -n grep -q "^DATABASE_URL=" "$ENV" || { echo "$NAME: no DATABASE_URL in $ENV, run jinx/bootstrap.sh first" >&2; exit 1; }

if ! cmp -s "/tmp/$NAME.service" "/etc/systemd/system/$NAME.service"; then
  sudo -n install -m 644 "/tmp/$NAME.service" "/etc/systemd/system/$NAME.service"
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable -q "$NAME"
fi
rm -f "/tmp/$NAME.service"

LIVE=/etc/caddy/conf.d/chorus.caddy
IN=/tmp/chorus.caddy
if cmp -s "$IN" "$LIVE"; then
  rm -f "$IN"
else
  # Imported into the config serving every site: validate, and restore on failure.
  sudo -n cp "$LIVE" "$IN.prev" 2>/dev/null || true
  sudo -n install -m 644 "$IN" "$LIVE" && rm -f "$IN"
  if ! caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    if [ -f "$IN.prev" ]; then sudo -n mv "$IN.prev" "$LIVE"; else sudo -n rm -f "$LIVE"; fi
    echo "$NAME: site block rejected by caddy validate, config unchanged" >&2
    exit 1
  fi
  sudo -n rm -f "$IN.prev"
  sudo -n systemctl reload caddy
fi

[ -d /opt/apps/Chorus/.git ] || git clone -q https://github.com/MayurJivani/Chorusify.git /opt/apps/Chorus
cd /opt/apps/Chorus
git pull -q --ff-only
HUSKY=0 npm ci --legacy-peer-deps --no-audit --no-fund --loglevel=error
VITE_API_URL=/api npm run build:full
npm prune --omit=dev --legacy-peer-deps
# The box npm may rewrite the lockfile in its own dialect; put it back so the next pull fast-forwards.
git checkout -- package-lock.json
sudo -n systemctl restart "$NAME"

# Come back and check through Caddy, rather than trusting that a restart meant "serving".
for _ in $(seq 1 30); do
  curl -sf -o /dev/null -H "Host: $SITE" http://127.0.0.1/api/health && break
  sleep 1
done
curl -sf -o /dev/null -H "Host: $SITE" http://127.0.0.1/api/health || {
  echo "$NAME: not serving through Caddy"; sudo -n journalctl -u "$NAME" -n 30 --no-pager; exit 1
}
BOX
echo "$NAME: deployed to https://$SITE"
