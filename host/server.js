import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8888;
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://host.docker.internal:8886';
const ADMIN_PORT = process.env.ADMIN_PORT || 8887;
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config', 'admin-config.json');

// --- Config persistence ---

function loadPersistedConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function savePersistedConfig() {
  const config = loadPersistedConfig();
  config.whitelist = [...state.ipWhitelist];
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error(`Failed to save config: ${err.message}`);
  }
}

// --- IP Whitelist ---

const ALLOWED_IPS_RAW = process.env.ALLOWED_IPS || '';

function parseIpEntry(entry) {
  entry = entry.trim();
  if (!entry) return null;
  const cidrMatch = entry.match(/^(.+)\/(\d+)$/);
  if (cidrMatch) {
    const ip = cidrMatch[1];
    const prefix = parseInt(cidrMatch[2], 10);
    return { type: 'cidr', ip, prefix };
  }
  return { type: 'exact', ip: entry };
}

function ipToLong(ip) {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function matchesEntry(clientIp, entry) {
  const normalizedClient = normalizeIp(clientIp);
  const normalizedEntry = normalizeIp(entry.ip);

  if (entry.type === 'exact') {
    return normalizedClient === normalizedEntry;
  }
  const clientLong = ipToLong(normalizedClient);
  const entryLong = ipToLong(normalizedEntry);
  if (clientLong === null || entryLong === null) return false;
  const mask = entry.prefix === 0 ? 0 : (~0 << (32 - entry.prefix)) >>> 0;
  return (clientLong & mask) === (entryLong & mask);
}

function buildAllowedEntries() {
  const entries = ALLOWED_IPS_RAW
    .split(',')
    .map(parseIpEntry)
    .filter(Boolean);
  for (const ip of state.ipWhitelist) {
    const parsed = parseIpEntry(ip);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function isLoopback(ip) {
  const normalized = normalizeIp(ip);
  return normalized === '127.0.0.1';
}

function isIpAllowed(ip) {
  if (isLoopback(ip)) return true; // Localhost always allowed
  const entries = buildAllowedEntries();
  if (entries.length === 0) return true;
  return entries.some(entry => matchesEntry(ip, entry));
}

function ipWhitelistMiddleware(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  if (isIpAllowed(clientIp)) return next();
  console.warn(`[IP BLOCKED] ${clientIp} → ${req.method} ${req.path} at ${new Date().toISOString()}`);
  res.status(403).json({ error: 'Forbidden: IP not allowed' });
}

// --- Shared state ---

const state = {
  serverStartTime: Date.now(),
  conversationHistory: [],
  connectedClients: new Map(),
  ipWhitelist: new Set(),
};

// Load persisted whitelist
(function loadWhitelist() {
  const config = loadPersistedConfig();
  if (Array.isArray(config.whitelist)) {
    config.whitelist.forEach(ip => state.ipWhitelist.add(ip));
  }
})();

// Log whitelist status
const envEntries = ALLOWED_IPS_RAW.split(',').map(parseIpEntry).filter(Boolean);
if (envEntries.length > 0 || state.ipWhitelist.size > 0) {
  const envPart = envEntries.map(e => e.type === 'cidr' ? `${e.ip}/${e.prefix}` : e.ip);
  const adminPart = [...state.ipWhitelist];
  console.log(`IP whitelist active: env=[${envPart.join(', ')}] admin=[${adminPart.join(', ')}]`);
} else {
  console.log('IP whitelist: disabled (no ALLOWED_IPS, no admin whitelist — all IPs allowed)');
}

// --- Client IP tracking middleware ---

function trackClient(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const existing = state.connectedClients.get(ip);
  if (existing) {
    existing.lastSeen = Date.now();
    existing.requestCount++;
  } else {
    state.connectedClients.set(ip, {
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      requestCount: 1,
    });
  }
  next();
}

// --- Client app (port 8888) ---

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'docs')));
app.use(['/api/command', '/api/status', '/api/events', '/api/respond'], trackClient);

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

// --- Client API Routes ---

app.get('/api/status', async (req, res) => {
  try {
    const bridgeStatus = await bridgeRequest('GET', '/status');
    res.json({
      bridge: bridgeStatus,
      historyLength: state.conversationHistory.length,
    });
  } catch {
    res.json({
      bridge: { status: 'unreachable' },
      historyLength: state.conversationHistory.length,
    });
  }
});

app.get('/api/history', (req, res) => {
  res.json({ history: state.conversationHistory });
});

app.post('/api/command', ipWhitelistMiddleware, async (req, res) => {
  const { command } = req.body;

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'Command is required' });
  }

  state.conversationHistory.push({
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

app.post('/api/respond', ipWhitelistMiddleware, async (req, res) => {
  const { response } = req.body;

  if (!response || typeof response !== 'string' || !response.trim()) {
    return res.status(400).json({ error: 'Response is required' });
  }

  state.conversationHistory.push({
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
    let sseBuf = '';

    bridgeRes.on('data', (chunk) => {
      try {
        res.write(chunk);
      } catch {
        // Client disconnected
      }

      sseBuf += chunk.toString();
      let boundary;
      while ((boundary = sseBuf.indexOf('\n\n')) !== -1) {
        const rawEvent = sseBuf.slice(0, boundary);
        sseBuf = sseBuf.slice(boundary + 2);

        const dataLines = rawEvent
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim());

        if (dataLines.length === 0) continue;

        try {
          const parsed = JSON.parse(dataLines.join(''));
          if (parsed.type === 'result' && parsed.result) {
            state.conversationHistory.push({
              role: 'assistant',
              content: parsed.result,
              timestamp: Date.now(),
            });
          }
        } catch {
          // Not valid JSON — ignore
        }
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

  req.on('close', () => {
    bridgeReq.destroy();
  });
});

app.post('/api/reset', ipWhitelistMiddleware, async (req, res) => {
  try {
    await bridgeRequest('POST', '/reset');
  } catch {
    // Bridge might be down
  }
  state.conversationHistory = [];
  res.json({ status: 'reset' });
});

// --- Admin app (port 8887) ---

const adminApp = express();
adminApp.use(express.json());
adminApp.use(express.static(path.join(__dirname, '..', 'admin')));

adminApp.get('/admin/api/status', async (req, res) => {
  let bridgeStatus;
  try {
    bridgeStatus = await bridgeRequest('GET', '/status');
  } catch {
    bridgeStatus = { status: 'unreachable' };
  }

  res.json({
    uptime: Date.now() - state.serverStartTime,
    serverStartTime: state.serverStartTime,
    bridge: bridgeStatus,
    clientPort: PORT,
    adminPort: ADMIN_PORT,
    bridgeUrl: BRIDGE_URL,
    memoryUsage: process.memoryUsage(),
  });
});

adminApp.get('/admin/api/session', async (req, res) => {
  let bridgeStatus;
  try {
    bridgeStatus = await bridgeRequest('GET', '/status');
  } catch {
    bridgeStatus = {};
  }

  res.json({
    sessionId: bridgeStatus.sessionId || null,
    state: bridgeStatus.state || 'unknown',
    workDir: bridgeStatus.workDir || null,
    messageCount: state.conversationHistory.length,
  });
});

adminApp.get('/admin/api/history', (req, res) => {
  res.json({ history: state.conversationHistory });
});

adminApp.get('/admin/api/clients', (req, res) => {
  const clients = [];
  for (const [ip, info] of state.connectedClients) {
    clients.push({ ip, ...info });
  }
  res.json({ clients });
});

adminApp.get('/admin/api/whitelist', (req, res) => {
  res.json({ whitelist: [...state.ipWhitelist] });
});

adminApp.post('/admin/api/whitelist', (req, res) => {
  const { ip } = req.body;
  if (!ip || typeof ip !== 'string') {
    return res.status(400).json({ error: 'IP is required' });
  }
  state.ipWhitelist.add(ip.trim());
  savePersistedConfig();
  res.json({ whitelist: [...state.ipWhitelist] });
});

adminApp.delete('/admin/api/whitelist', (req, res) => {
  const { ip } = req.body;
  if (!ip || typeof ip !== 'string') {
    return res.status(400).json({ error: 'IP is required' });
  }
  state.ipWhitelist.delete(ip.trim());
  savePersistedConfig();
  res.json({ whitelist: [...state.ipWhitelist] });
});

adminApp.get('/admin/api/config', (req, res) => {
  const config = loadPersistedConfig();
  res.json({
    workDir: config.workDir || process.env.CLAUDE_WORK_DIR || '.',
    bridgeUrl: BRIDGE_URL,
    whitelist: [...state.ipWhitelist],
  });
});

adminApp.post('/admin/api/config', (req, res) => {
  const { workDir } = req.body;
  if (!workDir || typeof workDir !== 'string') {
    return res.status(400).json({ error: 'workDir is required' });
  }
  const config = loadPersistedConfig();
  config.workDir = workDir.trim();
  config.whitelist = [...state.ipWhitelist];
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save: ${err.message}` });
  }
  res.json({ saved: true, workDir: config.workDir, note: 'Requires server restart to take effect' });
});

// --- Start both servers ---

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Client UI on port ${PORT}`);
  console.log(`Bridge URL: ${BRIDGE_URL}`);
});

adminApp.listen(ADMIN_PORT, '0.0.0.0', () => {
  console.log(`Admin UI on port ${ADMIN_PORT}`);
});
