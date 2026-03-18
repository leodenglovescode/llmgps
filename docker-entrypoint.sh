#!/bin/sh
set -e

# Ensure /data is writable by the node user (uid 1000).
# When a bind mount is created by Docker, the host directory may be owned by
# root, which prevents the non-root node user from writing the SQLite database.
if [ -d /data ]; then
  chown -R node:node /data
fi

exec su-exec node "$@"
