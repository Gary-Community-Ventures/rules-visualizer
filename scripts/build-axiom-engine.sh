#!/usr/bin/env bash
# Vendor + build the upstream axiom-rules-engine binary.
#
# Clones (or pulls) TheAxiomFoundation/rac into vendor/axiom-rules-engine/
# and runs `cargo build --release`. The resulting binary is what the RAC
# backend invokes via subprocess to execute RuleSpec programs.
#
# Idempotent — re-running pulls latest and rebuilds if anything changed.
# Works on macOS, Linux, and WSL. Requires `cargo` (Rust 1.85+ for edition 2024).
set -euo pipefail

UPSTREAM_REPO="https://github.com/TheAxiomFoundation/rac.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$REPO_ROOT/vendor/axiom-rules-engine"
BIN_NAME="axiom-rules-engine"

# --- Preflight ---
if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo not found. Install Rust:"
  echo "  macOS:   brew install rustup-init && rustup-init -y"
  echo "  Linux/WSL: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi

mkdir -p "$(dirname "$VENDOR_DIR")"

# --- Clone or update ---
if [ -d "$VENDOR_DIR/.git" ]; then
  echo "[axiom-engine] updating $VENDOR_DIR..."
  git -C "$VENDOR_DIR" fetch --quiet --depth=1 origin
  git -C "$VENDOR_DIR" reset --quiet --hard origin/HEAD
else
  echo "[axiom-engine] cloning $UPSTREAM_REPO into $VENDOR_DIR..."
  git clone --quiet --depth=1 "$UPSTREAM_REPO" "$VENDOR_DIR"
fi

CURRENT_REV="$(git -C "$VENDOR_DIR" rev-parse --short HEAD)"
echo "[axiom-engine] at commit $CURRENT_REV"

# --- Build ---
echo "[axiom-engine] cargo build --release ..."
(
  cd "$VENDOR_DIR"
  cargo build --release
)

BINARY="$VENDOR_DIR/target/release/$BIN_NAME"
if [ ! -x "$BINARY" ]; then
  echo "Error: build succeeded but binary missing at $BINARY"
  exit 1
fi

echo ""
echo "[axiom-engine] ready at: $BINARY"
echo ""
echo "The Python server discovers this by default — no env var needed if you"
echo "run from the repo root. To override, set AXIOM_RULES_ENGINE_BIN to an"
echo "absolute path."
