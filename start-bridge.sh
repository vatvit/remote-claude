#!/usr/bin/env bash
# Start the bridge on port 8886
# Usage: ./start-bridge.sh [work_dir]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="${1:-$(pwd)}"
exec python3 "$SCRIPT_DIR/bridge/bridge.py" 8886 "$WORK_DIR"
