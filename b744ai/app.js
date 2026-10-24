const API_ROOT = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://127.0.0.1:8787/api/b744ai'
  : 'https://flightdeck-api.201505-login.workers.dev/api/b744ai';
const TOKEN_KEY = 'b744ai-session';

const elements = {
  askForm: document.querySelector('#askForm'),
  askButton: document.querySelector('#askButton'),
  question: document.querySelector('#question'),
  characterCount: document.querySelector('#characterCount'),
  messages: document.querySelector('#messages'),
  manualList: document.querySelector('#manualList'),
  systemState: document.querySelector('#systemState'),
  stateTitle: document.querySelector('#stateTitle'),
  stateDetail: document.querySelector('#stateDetail'),
  sessionButton: document.querySelector('#sessionButton'),
  loginDialog: document.querySelector('#loginDialog'),
  loginForm: document.querySelector('#loginForm'),
  accessCode: document.querySelector('#accessCode'),
  loginError: document.querySelector('#loginError')
};

let sessionToken = sessionStorage.getItem(TOKEN_KEY) || '';
let serviceStatus = null;

function setSystemState(state, title, detail) {
  elements.systemState.dataset.state = state;
  elements.stateTitle.textContent = title;
  elements.stateDetail.textContent = detail;
}

function selectedManuals() {
  return [...elements.manualList.querySelectorAll('input:checked')].map(input => input.value);
}

function appendMessage(text, kind = 'assistant', sources = []) {
  const article = document.createElement('article');
  article.className = `message ${kind === 'user' ? 'user-message' : 'assistant-message'}`;

  if (kind !== 'user') {
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '✦';
    article.appendChild(avatar);
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = kind === 'user' ? '組員提問' : 'B744 AI · 飛航助理';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  body.append(meta, paragraph);

  if (sources.length) {
    const cards = document.createElement('div');
    cards.className = 'source-cards';
    for (const source of sources) {
      const card = document.createElement('div');
      card.className = 'source-card';
      const title = document.createElement('b');
      title.textContent = `${source.shortTitle || source.title} · R${source.revision}`;
      const detail = document.createElement('span');
      const printed = source.printedLabel ? `（印刷頁 ${source.printedLabel}）` : '';
      detail.textContent = `${source.chapter || '章節未標示'} · PDF 第 ${source.pdfPage} 頁${printed}`;
      card.append(title, detail);
      cards.appendChild(card);
    }
    body.appendChild(cards);
  }

  article.appendChild(body);
  elements.messages.appendChild(article);
  article.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return article;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({ ok: false, error: '服務回應格式錯誤' }));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function refreshStatus() {
  try {
    serviceStatus = await api('/status');
    if (serviceStatus.authenticated) {
      setSystemState('ready', '受保護服務已連線', `${serviceStatus.manualCount || 0} 本有效手冊 · AI ${serviceStatus.aiReady ? '可用' : '待設定'}`);
      elements.sessionButton.textContent = '已登入';
    } else if (serviceStatus.setupRequired) {
      setSystemState('offline', '安全設定進行中', '手冊內容尚未上線，不會公開資料');
    } else {
      setSystemState('locked', '受保護服務已就緒', '請由 B747-400F 組員登入');
    }
  } catch (error) {
    setSystemState('offline', '服務暫時無法連線', error.message);
  }
}

async function signIn(accessCode) {
  const result = await api('/session', {
    method: 'POST',
    body: JSON.stringify({ accessCode })
  });
  sessionToken = result.token;
  sessionStorage.setItem(TOKEN_KEY, sessionToken);
  elements.loginDialog.close();
  elements.loginForm.reset();
  elements.loginError.textContent = '';
  await refreshStatus();
}

elements.sessionButton.addEventListener('click', () => {
  if (sessionToken) {
    sessionToken = '';
    sessionStorage.removeItem(TOKEN_KEY);
    elements.sessionButton.textContent = '組員登入';
    refreshStatus();
    return;
  }
  elements.loginDialog.showModal();
  setTimeout(() => elements.accessCode.focus(), 0);
});

elements.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const code = elements.accessCode.value.trim();
  if (!code) return;
  elements.loginError.textContent = '';
  try {
    await signIn(code);
  } catch (error) {
    elements.loginError.textContent = error.status === 401 ? '存取碼不正確。' : error.message;
  }
});

elements.question.addEventListener('input', () => {
  elements.characterCount.textContent = `${elements.question.value.length} / 600`;
});

for (const button of document.querySelectorAll('[data-question]')) {
  button.addEventListener('click', () => {
    elements.question.value = button.dataset.question;
    elements.question.dispatchEvent(new Event('input'));
    elements.question.focus();
  });
}

elements.askForm.addEventListener('submit', async event => {
  event.preventDefault();
  const question = elements.question.value.trim();
  if (!question) return;
  if (!sessionToken) {
    elements.loginDialog.showModal();
    return;
  }

  appendMessage(question, 'user');
  elements.question.value = '';
  elements.question.dispatchEvent(new Event('input'));
  elements.askButton.disabled = true;
  const loading = appendMessage('正在比對受控手冊並整理文件依據…');

  try {
    const result = await api('/ask', {
      method: 'POST',
      body: JSON.stringify({ question, manualIds: selectedManuals() })
    });
    loading.remove();
    appendMessage(result.answer, 'assistant', result.sources || []);
  } catch (error) {
    loading.remove();
    if (error.status === 401) {
      sessionToken = '';
      sessionStorage.removeItem(TOKEN_KEY);
      elements.sessionButton.textContent = '組員登入';
      appendMessage('登入已失效，請重新登入後再試。');
    } else {
      appendMessage(error.message || '目前無法完成查詢，請稍後再試。');
    }
  } finally {
    elements.askButton.disabled = false;
    elements.question.focus();
  }
});

refreshStatus();
