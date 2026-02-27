const API_BASE = window.REMOTE_CLAUDE_API || '';
const chat = document.getElementById('chat');
const form = document.getElementById('form');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');

let isProcessing = false;
let eventSource = null;
let currentAssistantDiv = null;
let currentResultText = '';

// --- Status polling ---

async function checkStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    const bridgeState = data.bridge?.state || data.bridge?.status || 'unknown';
    if (data.bridge?.status === 'unreachable') {
      setStatus('disconnected');
    } else if (bridgeState === 'processing') {
      setStatus('processing');
    } else {
      setStatus('idle');
    }
  } catch {
    setStatus('disconnected');
  }
}

function setStatus(state) {
  statusEl.textContent = state;
  statusEl.className = `status ${state}`;
}

// --- SSE Event Stream ---

function connectEvents() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`${API_BASE}/api/events`);

  eventSource.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleClaudeMessage(msg);
    } catch {
      // Not JSON
    }
  });

  eventSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse(e.data);
      removeTypingIndicator();
      addMessage('error', data.error || 'Unknown error');
    } catch {
      // Connection error — will auto-reconnect
    }
  });

  eventSource.addEventListener('process_ended', () => {
    removeTypingIndicator();
    finishAssistantMessage();
    setInputEnabled(true);
    setStatus('idle');
  });

  eventSource.onerror = () => {
    // EventSource auto-reconnects
  };
}

function handleClaudeMessage(msg) {
  const msgType = msg.type || '';
  const msgSubtype = msg.subtype || '';

  // Assistant text content
  if (msgType === 'assistant' && msg.message?.content) {
    const textParts = msg.message.content.filter(b => b.type === 'text');
    const text = textParts.map(b => b.text).join('');

    if (text) {
      removeTypingIndicator();
      removeWorkingIndicator();
      if (!currentAssistantDiv) {
        currentResultText = '';
        currentAssistantDiv = addMessage('assistant', '');
        currentAssistantDiv.classList.add('streaming');
      }
      currentResultText += text;
      currentAssistantDiv.textContent = currentResultText;
      showWorkingIndicator();
      chat.scrollTop = chat.scrollHeight;
    }
  }

  // Final result
  if (msgType === 'result') {
    removeTypingIndicator();
    removeWorkingIndicator();
    const resultText = msg.result || currentResultText || '(no response)';

    if (currentAssistantDiv) {
      currentAssistantDiv.textContent = resultText;
      currentAssistantDiv.classList.remove('streaming');
    } else {
      addMessage('assistant', resultText);
    }

    currentAssistantDiv = null;
    currentResultText = '';
    setInputEnabled(true);
    setStatus('idle');
    chat.scrollTop = chat.scrollHeight;
  }
}

// --- Chat ---

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = content;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function addTypingIndicator() {
  removeWorkingIndicator();
  removeTypingIndicator();
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typing';
  div.textContent = 'Claude is working';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing');
  if (el) el.remove();
}

function showWorkingIndicator() {
  removeTypingIndicator();
  if (document.getElementById('working')) return;
  const div = document.createElement('div');
  div.className = 'working-indicator';
  div.id = 'working';
  div.innerHTML = '<div class="spinner"></div> Claude is working…';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function removeWorkingIndicator() {
  const el = document.getElementById('working');
  if (el) el.remove();
}

function finishAssistantMessage() {
  removeWorkingIndicator();
  removeTypingIndicator();
  if (currentAssistantDiv) {
    currentAssistantDiv.classList.remove('streaming');
    if (!currentAssistantDiv.textContent) {
      currentAssistantDiv.remove();
    }
    currentAssistantDiv = null;
    currentResultText = '';
  }
}

function setInputEnabled(enabled) {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  isProcessing = !enabled;
  if (enabled) input.focus();
}

// --- Send command ---

async function sendCommand(command) {
  addMessage('user', command);
  setInputEnabled(false);
  setStatus('processing');
  addTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    // Command was sent to bridge — output comes via SSE events
  } catch (err) {
    removeTypingIndicator();
    addMessage('error', err.message);
    setInputEnabled(true);
    setStatus('idle');
  }
}

// --- Send response (to Claude's question) ---

async function sendResponse(response) {
  addMessage('user', response);
  setInputEnabled(false);
  setStatus('processing');
  addTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    removeTypingIndicator();
    addMessage('error', err.message);
    setInputEnabled(true);
    setStatus('idle');
  }
}

// --- Form handler ---

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || isProcessing) return;
  input.value = '';

  // If Claude is waiting for input, use /respond; otherwise /command
  sendCommand(text);
});

// --- Load history on startup ---

async function loadHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/history`);
    const data = await res.json();
    for (const msg of data.history) {
      addMessage(msg.role, msg.content);
    }
  } catch {
    // Fresh start
  }
}

// --- Init ---

loadHistory();
checkStatus();
connectEvents();
setInterval(checkStatus, 5000);
