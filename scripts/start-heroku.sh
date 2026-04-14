#!/bin/sh
# Start the appropriate server based on APP_TYPE env var.
set -e

case "$APP_TYPE" in
  factgraph)
    exec node packages/factgraph-server/dist/index.js data/factgraph
    ;;
  rac)
    exec python -m rules_visualizer_rac.cli data/rac --no-open --port "$PORT"
    ;;
  *)
    echo "APP_TYPE must be 'factgraph' or 'rac' (got: '$APP_TYPE')" >&2
    exit 1
    ;;
esac
