# Remote Claude

## Project Overview

Web-based remote control for Claude Code. Four components:

1. **Web UI** (`docs/`) — Static HTML/JS page. User types text commands and sends them to the host server. Also deployed as GitHub Pages.
2. **Admin UI** (`admin/`) — Static HTML/JS dashboard for server management (status, clients, whitelist, config).
3. **Host Server** (`host/`) — Node.js Express server in Docker. Serves both UIs and proxies commands to the bridge.
4. **Bridge** (`bridge/`) — Python HTTP server on the host. Forwards commands to the locally authenticated `claude` CLI.

**No authentication/security** — designed for local internal WLAN only.

## Architecture

```
[Browser :8888] --HTTP--> [Docker: Express :8888] --HTTP--> [Host: Bridge :8886] --stdin/stdout--> [claude CLI]
                <--SSE---                         <--SSE---                       <--stream-json---
```

**Port scheme:**
- 8888 — Remote client UI (Express in Docker)
- 8887 — Admin UI (Express in Docker, same process as client)
- 8886 — Host bridge (Python, runs on host)

## Tech Stack

- **Web UI**: HTML, CSS, vanilla JavaScript (no build step)
- **Host Server**: Node.js, Express (in Docker)
- **Bridge**: Python 3 (on host, no external deps)
- **Claude CLI**: `claude -p --output-format stream-json`

## Project Structure

```
docs/             # Static web UI (served by Express + GitHub Pages)
  index.html
  style.css
  app.js
admin/            # Admin dashboard UI (served on port 8887)
  index.html
  style.css
  app.js
host/             # Node.js Express server (Docker)
  package.json
  server.js
bridge/           # Python bridge (runs on host)
  bridge.py
config/           # Persistent admin config (whitelist, workdir)
docker-compose.yml
Dockerfile
CLAUDE.md
```

## How to Run

### 1. Start the bridge (on host)
```bash
python3 bridge/bridge.py 8886 /path/to/work/dir
```

### 2. Start the Docker server
```bash
docker compose up --build
```

### 3. Open the web UI
`http://<host-ip>:8888`

### 4. Open the admin UI
`http://<host-ip>:8887`

## API Endpoints

### Express Server (:8888)
- `POST /api/command` — Send a text command, streams SSE response
- `GET /api/status` — Server + bridge state
- `GET /api/history` — Conversation history array
- `POST /api/reset` — Clear session and history

### Admin Server (:8887)
- `GET /admin/api/status` — Server uptime, bridge state, memory
- `GET /admin/api/session` — Session ID, state, workdir, message count
- `GET /admin/api/history` — Conversation history (read-only)
- `GET /admin/api/clients` — Connected client IPs + metadata
- `GET /admin/api/whitelist` — IP whitelist
- `POST /admin/api/whitelist` — Add IP to whitelist
- `DELETE /admin/api/whitelist` — Remove IP from whitelist
- `GET /admin/api/config` — Current config
- `POST /admin/api/config` — Save config (requires restart)

### Bridge (:8886)
- `POST /command` — Send command to claude CLI, streams SSE response
- `GET /status` — Bridge health, session ID, work dir
- `POST /reset` — Clear claude session

## Development Rules

- Never run `node` or `npm` on local host — always use Docker
- Exception: `bridge/bridge.py` runs on host (needs host-level claude auth)
- No frameworks for the web UI — keep it plain HTML/JS
- No authentication layer (local WLAN only)
- Keep it simple — minimal dependencies
