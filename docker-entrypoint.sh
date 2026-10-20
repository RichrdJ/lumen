#!/bin/sh
set -e
# Bind-mounted data folders are often created as root; hand them to the app user
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
