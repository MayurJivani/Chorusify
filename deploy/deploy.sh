#!/bin/sh
# Ship Chorus to Jinx. The box keeps its own checkout at /opt/apps/Chorus, so the unit
# of deployment is a fast-forward of that checkout plus a rebuild. Nothing is
# copied from here, which is what makes a deploy from CI and a deploy from a
# laptop the same operation.
#
# --ff-only rather than a plain pull: if the checkout on the box has drifted,
# stop and say so rather than quietly merging something nobody wrote.
#
# Postgres is a separate service with its own volume, so the app image can be
# rebuilt freely. Migrations run from the app container on boot.
set -eu
ssh ssh.futile.studio '
  set -eu
  cd /opt/apps/Chorus
  git pull --ff-only
  docker compose up -d --build

  # Come back and check, rather than trusting that compose meant "serving".
  sleep 5
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ || true)
  case "$code" in
    2*|3*) echo "chorus: serving on 127.0.0.1:3001 (HTTP $code)" ;;
    *) echo "chorus: not serving (HTTP $code)"; docker compose logs --tail 30; exit 1 ;;
  esac
'
echo "chorus: deployed to https://chorusify.com"
