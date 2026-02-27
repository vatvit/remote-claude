#!/usr/bin/env bash
# Start bridge + docker compose for game_snake project
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="/Users/vatvit/projects/vatvit/game_snake"

exec "$SCRIPT_DIR/start-bridge.sh" "$WORK_DIR"
