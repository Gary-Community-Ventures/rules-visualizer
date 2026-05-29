#!/usr/bin/env bash
# Build the JVM bench harness: clones IRS-Public/fact-graph (if needed),
# publishes it locally, then packages our scala-cli harness into a fat jar.
#
# Outputs:
#   - vendor/fact-graph-jvm/                (gitignored — sibling clone)
#   - ~/.ivy2/local/gov.irs/factgraph_3/3.1.0-SNAPSHOT/  (ivy publishLocal)
#   - scripts/bench-engines/jvm/harness.jar (gitignored — fat jar, ~28MB)
#
# Requires: brew install openjdk@21 sbt scala-cli
set -euo pipefail

cd "$(dirname "$0")/../../.."  # repo root

if ! command -v sbt >/dev/null; then
  echo "sbt not on PATH. Install with: brew install openjdk@21 sbt scala-cli" >&2
  exit 1
fi
if ! command -v scala-cli >/dev/null; then
  echo "scala-cli not on PATH. Install with: brew install scala-cli" >&2
  exit 1
fi

# JAVA_HOME defaults to brew's openjdk@21 if not set externally.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -d vendor/fact-graph-jvm ]; then
  echo "Cloning IRS-Public/fact-graph into vendor/fact-graph-jvm/ …"
  mkdir -p vendor
  git clone --depth 1 https://github.com/IRS-Public/fact-graph.git vendor/fact-graph-jvm
fi

# Skip publishLocal if it's already there. Cheap idempotency.
IVY_DIR="$HOME/.ivy2/local/gov.irs/factgraph_3/3.1.0-SNAPSHOT"
if [ ! -f "$IVY_DIR/jars/factgraph_3.jar" ]; then
  echo "Publishing fact-graph 3.1.0-SNAPSHOT to ~/.ivy2/local …"
  (cd vendor/fact-graph-jvm && sbt -batch "factGraphJVM/publishLocal")
fi

echo "Packaging harness fat jar …"
cd scripts/bench-engines/jvm
scala-cli --power package Harness.scala --assembly -o harness.jar -f

echo "Done. harness.jar built at scripts/bench-engines/jvm/harness.jar"
