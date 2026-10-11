#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${AGENTHUB_NODE:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ] || ! "$NODE_BIN" -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<13))process.exit(1)' 2>/dev/null; then
  echo "Agenthub requires Node.js 22.13+ (recommended: 24 LTS). Install a compatible Node or set AGENTHUB_NODE to its executable path." >&2
  exit 1
fi
cd "$PROJECT_ROOT"
exec "$NODE_BIN" --import tsx scripts/cli.ts "$@"
