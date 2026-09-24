#!/bin/sh
# A fresh local database on every run: nothing carries over from a previous session.
# See RNF-10 in docs/requirements.md.
set -eu

if [ ! -f .env ]; then
  echo "Missing .env — run: cp .env.example .env" >&2
  exit 1
fi

set -a
. ./.env
set +a

: "${DIRECT_URL:?DIRECT_URL is missing in .env}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is missing in .env}"

docker compose down --volumes
docker compose up --detach --wait

npx prisma migrate deploy
DIRECT_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
