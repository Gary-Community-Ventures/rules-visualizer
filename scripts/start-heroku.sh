#!/bin/sh
# Start the appropriate server based on APP_TYPE env var.
set -e

case "$APP_TYPE" in
  factgraph)
    exec node packages/factgraph-server/dist/index.js data/factgraph
    ;;
  rac)
    # The "rac" name is kept for backwards-compat with existing Heroku
    # configs, but the backend now serves RuleSpec YAML (formerly the
    # "RAC" format was a different language; see README).
    exec python -m rules_visualizer_rac.cli data/rulespec --no-open --port "$PORT"
    ;;
  *)
    echo "APP_TYPE must be 'factgraph' or 'rac' (got: '$APP_TYPE')" >&2
    exit 1
    ;;
esac
