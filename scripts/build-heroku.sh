#!/bin/sh
# Build for Heroku based on APP_TYPE.
set -e

case "$APP_TYPE" in
  factgraph)
    npm run build:factgraph
    ;;
  factgraph-api)
    # API-only build. No frontend bundle (this server is JSON-only),
    # but factgraph-core must be compiled first since the API consumes it.
    npm run build:factgraph-api
    ;;
  rac)
    # Build the frontend and copy bundle into the rac-server's public dir.
    # Python deps are installed by the Python buildpack via requirements.txt.
    npm run build:frontend
    rm -rf packages/rac-server/public
    cp -r frontend/dist packages/rac-server/public
    ;;
  *)
    echo "APP_TYPE must be 'factgraph', 'factgraph-api', or 'rac' (got: '$APP_TYPE')" >&2
    exit 1
    ;;
esac
