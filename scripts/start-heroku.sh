#!/bin/sh
# Start the appropriate server based on APP_TYPE env var.
set -e

# Heroku Standard-1X dynos give 1 vCPU. Multiple simulation worker
# threads on that environment thrash against each other instead of
# scaling — measured 8 workers running ~no faster than 1, with much
# higher memory churn. Force single-worker mode here. On larger
# performance dynos this can be overridden via Heroku config vars.
export SIMULATION_WORKERS="${SIMULATION_WORKERS:-1}"

case "$APP_TYPE" in
  factgraph)
    exec node packages/factgraph-server/dist/index.js data/factgraph
    ;;
  factgraph-api)
    # Partner-facing Fact Graph adapter API. Deploys to its own Heroku app
    # so the visualizer and the integration target can scale and roll
    # independently (see packages/factgraph-api/README.md).
    exec node packages/factgraph-api/dist/index.js data/factgraph
    ;;
  rac)
    # The "rac" name is kept for backwards-compat with existing Heroku
    # configs, but the backend now serves RuleSpec YAML (formerly the
    # "RAC" format was a different language; see README).
    exec python -m rules_visualizer_rac.cli data/rulespec --no-open --port "$PORT"
    ;;
  *)
    echo "APP_TYPE must be 'factgraph', 'factgraph-api', or 'rac' (got: '$APP_TYPE')" >&2
    exit 1
    ;;
esac
