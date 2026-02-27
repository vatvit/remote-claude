import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8888;
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://host.docker.internal:8886';

// State
let conversationHistory = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

// --- Helper: simple bridge request ---

function bridgeRequest(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BRIDGE_URL);
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request(url, {
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// --- API Routes ---

app.get('/api/status', async (req, res) => {
  try {
    const bridgeStatus = await bridgeRequest('GET', '/status');
    res.json({
      bridge: bridgeStatus,
      historyLength: conversationHistory.length,
    });
  } catch {
    res.json({
      bridge: { status: 'unreachable' },
      historyLength: conversationHistory.length,
    });
  }
});

app.get('/api/history', (req, res) => {
  res.json({ history: conversationHistory });
});

// Send a command or response to Claude
app.post('/api/command', async (req, res) => {
  const { command } = req.body;

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'Command is required' });
  }

  conversationHistory.push({
    role: 'user',
    content: command.trim(),
    timestamp: Date.now(),
  });

  try {
    const result = await bridgeRequest('POST', '/command', { command: command.trim() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Bridge error: ${err.message}` });
  }
});

// Send a response to Claude's question (same as command, different semantic)
app.post('/api/respond', async (req, res) => {
  const { response } = req.body;

  if (!response || typeof response !== 'string' || !response.trim()) {
    return res.status(400).json({ error: 'Response is required' });
  }

  conversationHistory.push({
    role: 'user',
    content: response.trim(),
    timestamp: Date.now(),
  });

  try {
    const result = await bridgeRequest('POST', '/respond', { response: response.trim() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Bridge error: ${err.message}` });
  }
});

// SSE proxy — streams events from bridge to browser
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const url = new URL('/events', BRIDGE_URL);

  const bridgeReq = http.request(url, { method: 'GET' }, (bridgeRes) => {
    // Pipe bridge SSE directly to browser
    bridgeRes.on('data', (chunk) => {
      try {
        res.write(chunk);
      } catch {
        // Client disconnected
      }
    });

    bridgeRes.on('end', () => {
      res.end();
    });

    bridgeRes.on('error', () => {
      res.end();
    });
  });

  bridgeReq.on('error', (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });

  bridgeReq.end();

  // Clean up when client disconnects
  req.on('close', () => {
    bridgeReq.destroy();
  });
});

app.post('/api/reset', async (req, res) => {
  try {
    await bridgeRequest('POST', '/reset');
  } catch {
    // Bridge might be down
  }
  conversationHistory = [];
  res.json({ status: 'reset' });
});

// --- Start server ---

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Remote Claude host server listening on port ${PORT}`);
  console.log(`Bridge URL: ${BRIDGE_URL}`);
});
