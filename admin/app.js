const API = '/admin/api';

// --- Helpers ---

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString();
}

function formatAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k === 'textContent') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    }
  }
  if (children) {
    for (const child of Array.isArray(children) ? children : [children]) {
      if (typeof child === 'string') e.appendChild(document.createTextNode(child));
      else if (child) e.appendChild(child);
    }
  }
  return e;
}

async function apiFetch(path, opts) {
  const res = await fetch(API + path, opts);
  return res.json();
}

// --- Section: Status ---

async function loadStatus() {
  const body = document.getElementById('status-body');
  try {
    const data = await apiFetch('/status');
    const bridgeOk = data.bridge && data.bridge.status !== 'unreachable';
    body.innerHTML = '';
    const grid = el('div', { className: 'kv-list' });

    const rows = [
      ['Uptime', formatUptime(data.uptime)],
      ['Bridge', bridgeOk ? 'connected' : 'unreachable', bridgeOk ? 'success' : 'error'],
      ['Bridge State', data.bridge?.state || '—'],
      ['Bridge URL', data.bridgeUrl],
      ['Client Port', data.clientPort],
      ['Admin Port', data.adminPort],
      ['Memory (RSS)', formatBytes(data.memoryUsage?.rss || 0)],
    ];

    for (const [label, value, cls] of rows) {
      grid.appendChild(el('div', { className: 'kv-label', textContent: label }));
      const valEl = el('div', { className: 'kv-value' + (cls ? ' ' + cls : ''), textContent: value });
      grid.appendChild(valEl);
    }
    body.appendChild(grid);
  } catch (err) {
    body.innerHTML = `<span class="empty">Failed to load status: ${escapeHtml(err.message)}</span>`;
  }
}

// --- Section: Session ---

async function loadSession() {
  const body = document.getElementById('session-body');
  try {
    const data = await apiFetch('/session');
    body.innerHTML = '';
    const grid = el('div', { className: 'kv-list' });

    const rows = [
      ['Session ID', data.sessionId || 'none'],
      ['State', data.state],
      ['Work Dir', data.workDir || '—'],
      ['Messages', String(data.messageCount)],
    ];

    for (const [label, value] of rows) {
      grid.appendChild(el('div', { className: 'kv-label', textContent: label }));
      grid.appendChild(el('div', { className: 'kv-value', textContent: value }));
    }
    body.appendChild(grid);
  } catch (err) {
    body.innerHTML = `<span class="empty">Failed to load session: ${escapeHtml(err.message)}</span>`;
  }
}

// --- Section: History ---

async function loadHistory() {
  const body = document.getElementById('history-body');
  try {
    const data = await apiFetch('/history');
    body.innerHTML = '';

    if (!data.history || data.history.length === 0) {
      body.innerHTML = '<span class="empty">No messages yet</span>';
      return;
    }

    for (const msg of data.history) {
      const div = el('div', { className: `history-msg ${msg.role}` });
      const header = el('div');
      header.appendChild(el('span', { className: 'msg-role', textContent: msg.role }));
      if (msg.timestamp) {
        header.appendChild(el('span', { className: 'msg-time', textContent: formatTime(msg.timestamp) }));
      }
      div.appendChild(header);

      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content, null, 2);
      const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
      div.appendChild(el('div', { textContent: truncated }));
      body.appendChild(div);
    }
  } catch (err) {
    body.innerHTML = `<span class="empty">Failed to load history: ${escapeHtml(err.message)}</span>`;
  }
}

// --- Section: Clients ---

async function loadClients() {
  const body = document.getElementById('clients-body');
  try {
    const data = await apiFetch('/clients');
    body.innerHTML = '';

    if (!data.clients || data.clients.length === 0) {
      body.innerHTML = '<span class="empty">No clients connected yet</span>';
      return;
    }

    const table = el('table', { className: 'data-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    for (const h of ['IP', 'First Seen', 'Last Seen', 'Requests', '']) {
      headerRow.appendChild(el('th', { textContent: h }));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const client of data.clients) {
      const row = el('tr');
      row.appendChild(el('td', { textContent: client.ip }));
      row.appendChild(el('td', { textContent: formatTime(client.firstSeen) }));
      row.appendChild(el('td', { textContent: formatAgo(client.lastSeen) }));
      row.appendChild(el('td', { textContent: String(client.requestCount) }));

      const actionTd = el('td');
      const addBtn = el('button', {
        className: 'btn btn-small',
        textContent: '+ Whitelist',
        onClick: async () => {
          await apiFetch('/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: client.ip }),
          });
          loadWhitelist();
        },
      });
      actionTd.appendChild(addBtn);
      row.appendChild(actionTd);

      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  } catch (err) {
    body.innerHTML = `<span class="empty">Failed to load clients: ${escapeHtml(err.message)}</span>`;
  }
}

// --- Section: Whitelist ---

async function loadWhitelist() {
  const body = document.getElementById('whitelist-body');
  try {
    const data = await apiFetch('/whitelist');
    body.innerHTML = '';

    // Add form
    const form = el('div', { className: 'inline-form' });
    const input = el('input', { type: 'text', placeholder: 'IP address (e.g. 192.168.1.5)' });
    const addBtn = el('button', {
      textContent: 'Add',
      onClick: async () => {
        const ip = input.value.trim();
        if (!ip) return;
        await apiFetch('/whitelist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip }),
        });
        input.value = '';
        loadWhitelist();
      },
    });
    form.appendChild(input);
    form.appendChild(addBtn);
    body.appendChild(form);

    if (!data.whitelist || data.whitelist.length === 0) {
      body.appendChild(el('div', { className: 'empty', textContent: 'No IPs in whitelist (all IPs allowed unless ALLOWED_IPS env is set)' }));
      return;
    }

    const table = el('table', { className: 'data-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    for (const h of ['IP', '']) {
      headerRow.appendChild(el('th', { textContent: h }));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const ip of data.whitelist) {
      const row = el('tr');
      row.appendChild(el('td', { textContent: ip }));

      const actionTd = el('td');
      const removeBtn = el('button', {
        className: 'btn btn-small btn-danger',
        textContent: 'Remove',
        onClick: async () => {
          await apiFetch('/whitelist', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip }),
          });
          loadWhitelist();
        },
      });
      actionTd.appendChild(removeBtn);
      row.appendChild(actionTd);

      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  } catch (err) {
    body.innerHTML = `<span class="empty">Failed to load whitelist: ${escapeHtml(err.message)}</span>`;
  }
}

// --- Section: Config ---

async function loadConfig() {
  const body = document.getElementById('config-body');
  try {
    const data = await apiFetch('/config');
    body.innerHTML = '';

    const grid = el('div', { className: 'kv-list' });
    grid.appendChild(el('div', { className: 'kv-label', textContent: 'Current Work Dir' }));
    grid.appendChild(el('div', { className: 'kv-value', textContent: data.workDir }));
    grid.appendChild(el('div', { className: 'kv-label', textContent: 'Bridge URL' }));
    grid.appendChild(el('div', { className: 'kv-value', textContent: data.bridgeUrl }));
    body.appendChild(grid);

    const divider = el('div', { style: 'margin: 16px 0; border-top: 1px solid var(--border)' });
    body.appendChild(divider);

    const label = el('div', { className: 'kv-label', textContent: 'Change Work Directory', style: 'margin-bottom: 8px' });
    body.appendChild(label);

    const form = el('div', { className: 'inline-form' });
    const input = el('input', { type: 'text', placeholder: '/path/to/work/dir', value: data.workDir });
    const saveBtn = el('button', {
      textContent: 'Save',
      onClick: async () => {
        const workDir = input.value.trim();
        if (!workDir) return;
        const result = await apiFetch('/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workDir }),
        });
        if (result.saved) {
          loadConfig();
        }
      },
    });
    form.appendChild(input);
    form.appendChild(saveBtn);
    body.appendChild(form);

    body.appendChild(el('div', { className: 'note', textContent: 'Requires server restart to take effect.' }));
  } catch (err) {
    body.innerHTML = `<span class="empty">Failed to load config: ${escapeHtml(err.message)}</span>`;
  }
}

// --- Init ---

function refreshAll() {
  loadStatus();
  loadSession();
  loadHistory();
  loadClients();
  loadWhitelist();
  loadConfig();
}

document.getElementById('refresh-btn').addEventListener('click', refreshAll);

refreshAll();
setInterval(refreshAll, 10000);
