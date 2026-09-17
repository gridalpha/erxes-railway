#!/bin/sh
set -e

echo "[entrypoint] erxes core-api starting"

# Close the first-owner claim window before this container ever serves a
# request.  seed-owner.mjs is a no-op once an account exists, so every later
# deploy pays only one MongoDB round trip.
if [ -n "${ERXES_OWNER_EMAIL:-}" ] && [ -n "${ERXES_OWNER_PASSWORD:-}" ]; then
  node /app/seed-owner.mjs || echo "[entrypoint] seed-owner exited non-zero; continuing"
else
  echo "[entrypoint] ERXES_OWNER_* unset — erxes' own first-run owner form stays open"
fi

echo "[entrypoint] exec core-api on port ${PORT:-3300}"
exec node dist/src/main.js
