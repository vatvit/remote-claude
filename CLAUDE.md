# Remote Claude

## Project Overview

Web-based remote control for Claude Code. Two components:

1. **Web UI** (`web/`) — Static HTML/JS page. User types text commands and sends them to the host server.
2. **Host Server** (`host/`) — Node.js server running on the target PC. Receives commands via HTTP API and forwards them to a local Claude Code CLI process in a configured project folder.

**No authentication/security** — designed for local internal WLAN only.

## Architecture

```
[Browser: Web UI] --HTTP POST--> [Host Server on target PC] --stdin--> [Claude Code CLI]
                  <--SSE/poll---                            <--stdout--
```

- Web UI is a plain static site (HTML + vanilla JS, no framework)
- Host Server is a Node.js Express app (ES modules)
- Communication: REST API + Server-Sent Events (SSE) for streaming responses
- Claude Code integration via @anthropic-ai/claude-code SDK

## Tech Stack

- **Web UI**: HTML, CSS, vanilla JavaScript (no build step)
- **Host Server**: Node.js, Express
- **Container**: Docker (for running Node.js — never run node/npm on host directly)

## Project Structure

```
web/              # Static web UI
  index.html
  style.css
  app.js
host/             # Node.js host server
  package.json
  server.js
docker-compose.yml
Dockerfile
CLAUDE.md
```

## How to Run

### Development (with hot reload)
```bash
docker compose up --build
```

### Configuration
Copy `.env.example` to `.env` and set:
- `CLAUDE_WORK_DIR` — host path to mount as Claude Code's working directory
- `ANTHROPIC_API_KEY` — Anthropic API key for Claude Code SDK

### Web UI
Served by the host server as static files, accessible at `http://<host-ip>:8888`

## API Endpoints

- `POST /api/command` — Send a text command `{ "command": "..." }`
- `GET /api/stream` — SSE endpoint for streaming Claude Code output
- `GET /api/status` — Check if Claude Code process is running

## Development Rules

- Never run `node` or `npm` on local host — always use Docker
- No frameworks for the web UI — keep it plain HTML/JS
- No authentication layer (local WLAN only)
- Keep it simple — minimal dependencies
