#!/bin/sh
# Build for Heroku based on APP_TYPE.
set -e

case "$APP_TYPE" in
  factgraph)
    npm run build:factgraph
    ;;
  rac)
    # Build the frontend and copy bundle into the rac-server's public dir.
    # Python deps are installed by the Python buildpack via requirements.txt.
    npm run build:frontend
    rm -rf packages/rac-server/public
    cp -r frontend/dist packages/rac-server/public
    ;;
  *)
    echo "APP_TYPE must be 'factgraph' or 'rac' (got: '$APP_TYPE')" >&2
    exit 1
    ;;
esac
