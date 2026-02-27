#!/usr/bin/env python3
"""
Remote Claude Bridge
HTTP server that runs claude CLI commands with stream-json output.
Each message spawns `claude -p` with --resume for session continuity.
Runs on the HOST machine (not in Docker) to use host-level auth.

Usage: python3 bridge.py [port] [work_dir]

Endpoints:
  POST /command  - Send a user message
  POST /respond  - Send a response to Claude's question
  GET  /events   - SSE stream of all Claude output events
  GET  /status   - Bridge health check
  POST /reset    - Clear session
"""

import sys
import os
import json
import subprocess
import threading
import queue
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8886
WORK_DIR = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.getcwd()


def log(msg):
    from datetime import datetime
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[bridge {ts}] {msg}", flush=True)


class ClaudeBridge:
    """Manages claude CLI invocations with session continuity."""

    def __init__(self, work_dir):
        self.work_dir = work_dir
        self.session_id = None
        self.state = "idle"  # idle, processing
        self.current_proc = None
        self.lock = threading.Lock()
        self.event_listeners = []
        self.listeners_lock = threading.Lock()

    @property
    def is_busy(self):
        return self.state == "processing"

    def send_message(self, user_message):
        """Run claude -p with the message and stream output via SSE."""
        with self.lock:
            if self.state == "processing":
                return False, "Already processing a message"
            self.state = "processing"

        # Run in a thread so we don't block the HTTP response
        threading.Thread(
            target=self._run_claude,
            args=(user_message,),
            daemon=True,
        ).start()

        return True, None

    def _run_claude(self, user_message):
        """Spawn claude -p and stream its output."""
        claude_args = [
            "claude",
            "-p", user_message,
            "--output-format", "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ]

        if self.session_id:
            claude_args.extend(["--resume", self.session_id])

        env = os.environ.copy()
        env.pop("CLAUDECODE", None)

        log(f"Running: claude -p '{user_message[:80]}...' (session={self.session_id})")

        try:
            proc = subprocess.Popen(
                claude_args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=self.work_dir,
                env=env,
            )
            self.current_proc = proc

            # Read stderr in background
            stderr_lines = []
            def read_stderr():
                for line in proc.stderr:
                    line = line.decode("utf-8", errors="replace").strip()
                    if line:
                        stderr_lines.append(line)
                        log(f"!!! stderr: {line}")
            stderr_thread = threading.Thread(target=read_stderr, daemon=True)
            stderr_thread.start()

            # Read stdout line by line (no buffering issue since process exits)
            for line in proc.stdout:
                line = line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                log(f"<<< {line[:300]}")

                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    log(f"<<< Non-JSON: {line[:200]}")
                    continue

                # Capture session_id
                if "session_id" in msg:
                    self.session_id = msg["session_id"]
                    log(f"Session: {self.session_id}")

                msg_type = msg.get("type", "")

                if msg_type == "result":
                    log("Result received")

                # Broadcast to SSE listeners
                self._broadcast_event("message", msg)

            proc.wait()
            stderr_thread.join(timeout=2)
            log(f"Process exited with code {proc.returncode}")

            if proc.returncode != 0 and stderr_lines:
                error_msg = stderr_lines[-1] if stderr_lines else f"Exit code {proc.returncode}"
                self._broadcast_event("error", {"error": error_msg})

        except Exception as e:
            log(f"Error running claude: {e}")
            self._broadcast_event("error", {"error": str(e)})
        finally:
            self.current_proc = None
            self.state = "idle"
            self._broadcast_event("process_ended", {
                "sessionId": self.session_id,
            })

    def add_listener(self):
        q = queue.Queue()
        with self.listeners_lock:
            self.event_listeners.append(q)
        log(f"SSE listener added (total: {len(self.event_listeners)})")
        return q

    def remove_listener(self, q):
        with self.listeners_lock:
            try:
                self.event_listeners.remove(q)
            except ValueError:
                pass
        log(f"SSE listener removed (total: {len(self.event_listeners)})")

    def _broadcast_event(self, event_type, data):
        with self.listeners_lock:
            count = len(self.event_listeners)
            dead = []
            for q in self.event_listeners:
                try:
                    q.put_nowait((event_type, data))
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self.event_listeners.remove(q)
        if count == 0:
            log(f"WARNING: No SSE listeners for {event_type}")

    def reset(self):
        if self.current_proc and self.current_proc.poll() is None:
            self.current_proc.terminate()
        self.session_id = None
        self.state = "idle"
        log("Session reset")


# Global bridge
claude = ClaudeBridge(WORK_DIR)


class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log(f"{self.command} {self.path}")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            return self.rfile.read(content_length)
        return b""

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/status":
            self.send_json(200, {
                "status": "ok",
                "state": claude.state,
                "sessionId": claude.session_id,
                "listeners": len(claude.event_listeners),
                "workDir": WORK_DIR,
            })
            return

        if path == "/events":
            self._handle_sse()
            return

        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/reset":
            claude.reset()
            self.send_json(200, {"status": "reset"})
            return

        if path == "/command":
            body = self.read_body()
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self.send_json(400, {"error": "invalid JSON"})
                return

            command = data.get("command", "").strip()
            if not command:
                self.send_json(400, {"error": "command is required"})
                return

            log(f"Command: {command[:100]}")

            ok, err = claude.send_message(command)
            if ok:
                self.send_json(200, {
                    "status": "sent",
                    "sessionId": claude.session_id,
                })
            else:
                self.send_json(409, {"error": err})
            return

        if path == "/respond":
            body = self.read_body()
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self.send_json(400, {"error": "invalid JSON"})
                return

            response = data.get("response", "").strip()
            if not response:
                self.send_json(400, {"error": "response is required"})
                return

            log(f"User response: {response[:100]}")

            ok, err = claude.send_message(response)
            if ok:
                self.send_json(200, {"status": "sent"})
            else:
                self.send_json(409, {"error": err})
            return

        self.send_json(404, {"error": "not found"})

    def _handle_sse(self):
        """SSE endpoint — streams all claude events to the client."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_cors_headers()
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = claude.add_listener()
        try:
            while True:
                try:
                    event_type, data = q.get(timeout=30)
                    payload = json.dumps(data) if isinstance(data, dict) else str(data)
                    self.wfile.write(f"event: {event_type}\ndata: {payload}\n\n".encode())
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(": keepalive\n\n".encode())
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            claude.remove_listener(q)


class ThreadedHTTPServer(HTTPServer):
    """Handle each request in a new thread."""
    def process_request(self, request, client_address):
        t = threading.Thread(target=self._handle, args=(request, client_address))
        t.daemon = True
        t.start()

    def _handle(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except ConnectionResetError:
            pass  # Client disconnected — normal for SSE
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


def main():
    log(f"Starting on port {PORT}")
    log(f"Working directory: {WORK_DIR}")

    try:
        result = subprocess.run(["claude", "--version"], capture_output=True, text=True)
        log(f"Claude CLI: {result.stdout.strip()}")
    except FileNotFoundError:
        log("WARNING: claude CLI not found in PATH")

    server = ThreadedHTTPServer(("0.0.0.0", PORT), BridgeHandler)
    log("Waiting for connections...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Shutting down...")
        claude.reset()
        server.shutdown()


if __name__ == "__main__":
    main()
