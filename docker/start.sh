#!/bin/sh
set -eu

case "${PROCESS_TYPE:-api}" in
  api)
    exec node --import ./src/instrumentation.js server.js
    ;;
  worker)
    exec node --import ./src/instrumentation.js worker.js
    ;;
  migrate)
    exec node scripts/migrate.js
    ;;
  *)
    echo "Unknown PROCESS_TYPE: ${PROCESS_TYPE}" >&2
    exit 1
    ;;
esac
