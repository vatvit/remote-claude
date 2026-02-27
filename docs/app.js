let API_BASE = new URLSearchParams(window.location.search).get('host') || window.REMOTE_CLAUDE_API || '';
const chat = document.getElementById('chat');
const form = document.getElementById('form');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const hostInput = document.getElementById('host-input');
const hostForm = document.getElementById('host-form');

// Pre-fill host input from GET param
hostInput.value = API_BASE;

hostForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = hostInput.value.trim().replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);
  if (val) {
    params.set('host', val);
  } else {
    params.delete('host');
  }
  const qs = params.toString();
  window.location.search = qs ? `?${qs}` : '';
});

let isProcessing = false;
let eventSource = null;
let currentAssistantDiv = null;
let currentResultText = '';
let pendingQuestions = [];

// --- Markdown rendering ---

function configureMarked() {
  if (typeof marked === 'undefined') return;
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function(code, lang) {
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      if (typeof hljs !== 'undefined') {
        return hljs.highlightAuto(code).value;
      }
      return code;
    },
  });
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text);
  try {
    return marked.parse(text);
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setMessageMarkdown(el, text) {
  el.innerHTML = renderMarkdown(text);
  el.querySelectorAll('a').forEach(a => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  addCopyButtons(el);
}

function addCopyButtons(el) {
  el.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

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

    if (pendingQuestions.length > 0) {
      showQuestionCard(pendingQuestions);
      pendingQuestions = [];
    } else {
      setInputEnabled(true);
    }

    setStatus('idle');
  });

  eventSource.onerror = () => {
    // EventSource auto-reconnects
  };
}

function handleClaudeMessage(msg) {
  const msgType = msg.type || '';

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

    // Check for AskUserQuestion tool_use blocks
    const askBlocks = msg.message.content.filter(
      b => b.type === 'tool_use' && b.name === 'AskUserQuestion'
    );
    for (const block of askBlocks) {
      if (block.input?.questions) {
        pendingQuestions = pendingQuestions.concat(block.input.questions);
      }
    }
  }

  // Final result
  if (msgType === 'result') {
    removeTypingIndicator();
    removeWorkingIndicator();
    const resultText = msg.result || currentResultText || '(no response)';

    if (currentAssistantDiv) {
      setMessageMarkdown(currentAssistantDiv, resultText);
      currentAssistantDiv.classList.remove('streaming');
    } else {
      addMessage('assistant', resultText);
    }

    currentAssistantDiv = null;
    currentResultText = '';

    if (pendingQuestions.length > 0) {
      showQuestionCard(pendingQuestions);
      pendingQuestions = [];
    } else {
      setInputEnabled(true);
    }

    setStatus('idle');
    chat.scrollTop = chat.scrollHeight;
  }
}

// --- Chat ---

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (role === 'assistant') {
    setMessageMarkdown(div, content);
  } else {
    div.textContent = content;
  }
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
    if (!currentAssistantDiv.textContent && !currentAssistantDiv.innerHTML.trim()) {
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

// --- Question card UI ---

function removeQuestionCard() {
  const existing = document.getElementById('question-card');
  if (existing) existing.remove();
}

function showQuestionCard(questions) {
  removeQuestionCard();

  const answers = new Array(questions.length).fill(null);
  let currentIndex = 0;

  const card = document.createElement('div');
  card.className = 'question-card';
  card.id = 'question-card';

  function render() {
    const q = questions[currentIndex];
    card.innerHTML = '';

    // Header with counter
    if (questions.length > 1) {
      const header = document.createElement('div');
      header.className = 'question-header';
      header.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
      card.appendChild(header);
    }

    // Question text
    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = q.header || q.question;
    card.appendChild(questionText);

    if (q.header && q.question && q.header !== q.question) {
      const subText = document.createElement('div');
      subText.className = 'question-subtext';
      subText.textContent = q.question;
      card.appendChild(subText);
    }

    // Option buttons
    if (q.options && q.options.length > 0) {
      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'question-options';

      for (const opt of q.options) {
        const btn = document.createElement('button');
        btn.className = 'question-option';
        if (answers[currentIndex] === opt.label) {
          btn.classList.add('selected');
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'question-option-label';
        labelSpan.textContent = opt.label;
        btn.appendChild(labelSpan);

        if (opt.description) {
          const descSpan = document.createElement('span');
          descSpan.className = 'question-option-desc';
          descSpan.textContent = opt.description;
          btn.appendChild(descSpan);
        }

        btn.addEventListener('click', () => {
          answers[currentIndex] = opt.label;
          advanceOrSubmit();
        });

        optionsContainer.appendChild(btn);
      }

      card.appendChild(optionsContainer);
    }

    // Custom answer input
    const customArea = document.createElement('div');
    customArea.className = 'question-custom';

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Custom answer...';
    customInput.className = 'question-custom-input';
    if (answers[currentIndex] && !isOptionLabel(q, answers[currentIndex])) {
      customInput.value = answers[currentIndex];
    }

    const customBtn = document.createElement('button');
    customBtn.className = 'question-custom-btn';
    customBtn.textContent = 'Submit';
    customBtn.addEventListener('click', () => {
      const val = customInput.value.trim();
      if (!val) return;
      answers[currentIndex] = val;
      advanceOrSubmit();
    });

    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        customBtn.click();
      }
    });

    customArea.appendChild(customInput);
    customArea.appendChild(customBtn);
    card.appendChild(customArea);

    // Navigation buttons
    if (questions.length > 1) {
      const nav = document.createElement('div');
      nav.className = 'question-nav';

      const backBtn = document.createElement('button');
      backBtn.textContent = 'Back';
      backBtn.disabled = currentIndex === 0;
      backBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
          currentIndex--;
          render();
        }
      });

      const fwdBtn = document.createElement('button');
      fwdBtn.textContent = 'Forward';
      fwdBtn.disabled = currentIndex === questions.length - 1 || answers[currentIndex] === null;
      fwdBtn.addEventListener('click', () => {
        if (currentIndex < questions.length - 1 && answers[currentIndex] !== null) {
          currentIndex++;
          render();
        }
      });

      nav.appendChild(backBtn);
      nav.appendChild(fwdBtn);
      card.appendChild(nav);
    }

    chat.scrollTop = chat.scrollHeight;
  }

  function isOptionLabel(q, value) {
    if (!q.options) return false;
    return q.options.some(opt => opt.label === value);
  }

  function advanceOrSubmit() {
    if (currentIndex < questions.length - 1) {
      currentIndex++;
      render();
    } else {
      submitAllAnswers();
    }
  }

  function submitAllAnswers() {
    removeQuestionCard();
    let responseText;
    if (questions.length === 1) {
      responseText = answers[0] || '';
    } else {
      responseText = answers
        .map((a, i) => `${i + 1}. ${a || ''}`)
        .join('\n');
    }
    if (responseText) {
      sendCommand(responseText);
    } else {
      setInputEnabled(true);
    }
  }

  chat.appendChild(card);
  render();
}

// --- Form handler ---

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || isProcessing) return;
  input.value = '';

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

configureMarked();
loadHistory();
checkStatus();
connectEvents();
setInterval(checkStatus, 5000);
