import {
  DEFAULT_SETTINGS,
  appendMessage,
  buildCustomRequestBody,
  buildOpenAIRequestBody,
  createChat,
  createInitialState,
  deleteChat,
  extractAssistantReply,
  getActiveChat,
  renameChat,
  renderMarkdown,
  setActiveChat,
  updateSettings,
} from './app-core.js';

const STORAGE_KEY = 'qwen-console-state-v1';
const TYPE_SPEED_MS = 10;

const els = {
  chatList: document.querySelector('#chatList'),
  messages: document.querySelector('#messages'),
  composer: document.querySelector('#composer'),
  messageInput: document.querySelector('#messageInput'),
  newChatBtn: document.querySelector('#newChatBtn'),
  renameChatBtn: document.querySelector('#renameChatBtn'),
  deleteChatBtn: document.querySelector('#deleteChatBtn'),
  exportChatBtn: document.querySelector('#exportChatBtn'),
  stopBtn: document.querySelector('#stopBtn'),
  sendBtn: document.querySelector('#sendBtn'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  hintText: document.querySelector('#hintText'),
};

let state = loadState();
let settings = updateSettings(DEFAULT_SETTINGS);
let abortController = null;
let typingMessageId = null;
let typingTimer = null;

if (state.chats.length === 0) {
  state = createChat(state, 'Первый чат');
}

render();

els.newChatBtn.addEventListener('click', () => {
  stopTyping();
  state = createChat(state, `Чат ${state.chats.length + 1}`);
  saveState();
  render();
});

els.renameChatBtn.addEventListener('click', () => {
  const chat = getActiveChat(state);
  if (!chat) return;
  const title = window.prompt('Название чата', chat.title);
  if (title === null) return;
  state = renameChat(state, chat.id, title);
  saveState();
  render();
});

els.deleteChatBtn.addEventListener('click', () => {
  const chat = getActiveChat(state);
  if (!chat) return;
  const confirmed = window.confirm(`Удалить "${chat.title}"?`);
  if (!confirmed) return;
  stopTyping();
  state = deleteChat(state, chat.id);
  if (state.chats.length === 0) state = createChat(state, 'Новый чат');
  saveState();
  render();
});

els.exportChatBtn.addEventListener('click', () => {
  const chat = getActiveChat(state);
  if (!chat) return;
  const blob = new Blob([JSON.stringify(chat, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${chat.title.replace(/[^\wа-яё-]+/gi, '_') || 'chat'}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

els.chatList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-chat-id]');
  if (!button) return;
  stopTyping();
  state = setActiveChat(state, button.dataset.chatId);
  saveState();
  render();
});

els.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  await sendMessage();
});

els.messageInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  if (event.shiftKey) return;
  event.preventDefault();
  await sendMessage();
});

els.stopBtn.addEventListener('click', () => {
  abortController?.abort();
  stopTyping();
});

async function sendMessage() {
  const chat = getActiveChat(state);
  const content = els.messageInput.value.trim();
  if (!chat || !content || abortController) return;

  stopTyping();
  els.messageInput.value = '';
  state = appendMessage(state, chat.id, { role: 'user', content });
  saveState();
  render();
  await requestAssistant(chat.id);
}

async function requestAssistant(chatId) {
  settings = updateSettings(DEFAULT_SETTINGS);

  if (!settings.endpoint.trim()) {
    state = appendMessage(state, chatId, {
      role: 'assistant',
      content: 'Endpoint API пока не указан. Добавьте адрес сервера в API_CONFIG_PLACEHOLDER в app-core.js.',
      error: true,
    });
    saveState();
    render();
    return;
  }

  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;

  abortController = new AbortController();
  setBusy(true);
  renderThinking();

  try {
    const cleanMessages = chat.messages.filter((message) => !message.error);
    const body =
      settings.mode === 'openai'
        ? buildOpenAIRequestBody({ ...settings, messages: cleanMessages })
        : buildCustomRequestBody({ ...settings, messages: cleanMessages });

    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    const text = await response.text();
    const payload = parseResponse(text);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${extractAssistantReply(payload) || text}`);
    }

    state = appendMessage(state, chatId, {
      role: 'assistant',
      content: extractAssistantReply(payload) || 'Пустой ответ от сервера.',
    });
    saveState();
    render();

    const lastMessage = getActiveChat(state)?.messages.at(-1);
    if (lastMessage?.role === 'assistant' && !lastMessage.error) {
      startTyping(lastMessage.id, lastMessage.content);
    }
  } catch (error) {
    const aborted = error.name === 'AbortError';
    state = appendMessage(state, chatId, {
      role: 'assistant',
      content: aborted ? 'Запрос остановлен.' : `Ошибка API: ${error.message}`,
      error: !aborted,
    });
    saveState();
    render();
  } finally {
    abortController = null;
    setBusy(false);
  }
}

function buildHeaders(currentSettings) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentSettings.apiKey.trim()) {
    headers.Authorization = `Bearer ${currentSettings.apiKey.trim()}`;
  }
  return headers;
}

function parseResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function render() {
  renderChatList();
  renderMessages();
  renderStatus();
}

function renderChatList() {
  els.chatList.innerHTML = '';
  state.chats
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((chat) => {
      const button = document.createElement('button');
      button.className = `chat-item${chat.id === state.activeChatId ? ' active' : ''}`;
      button.type = 'button';
      button.dataset.chatId = chat.id;
      button.innerHTML = `
        <span class="chat-title"></span>
        <span class="chat-meta">${chat.messages.length} сообщений</span>
      `;
      button.querySelector('.chat-title').textContent = chat.title;
      els.chatList.append(button);
    });
}

function renderMessages() {
  const chat = getActiveChat(state);
  els.messages.innerHTML = '';

  if (!chat || chat.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <span class="eyebrow">Qwen PlusPlus SuperPower</span>
      <h2>Готов к разговору</h2>
      <p>Создавайте отдельные чаты, отправляйте сообщения клавишей Enter и получайте ответы с форматированием. Shift+Enter переносит строку.</p>
    `;
    els.messages.append(empty);
    return;
  }

  chat.messages.forEach((message) => {
    const row = document.createElement('article');
    row.className = `message ${message.role}${message.error ? ' error' : ''}`;

    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = message.role === 'user' ? 'Вы' : message.error ? 'Ошибка' : 'AI';

    const bubble = document.createElement('div');
    bubble.className = 'bubble markdown-body';
    bubble.dataset.messageId = message.id;

    if (message.role === 'assistant' && !message.error) {
      bubble.innerHTML =
        typingMessageId === message.id ? escapeText(message.content) : renderMarkdown(message.content);
    } else {
      bubble.textContent = message.content;
    }

    const actions = document.createElement('div');
    actions.className = 'bubble-actions';
    const copy = document.createElement('button');
    copy.className = 'ghost-button compact';
    copy.type = 'button';
    copy.textContent = 'Копировать';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(message.content);
      copy.textContent = 'Скопировано';
      window.setTimeout(() => (copy.textContent = 'Копировать'), 1200);
    });
    actions.append(copy);
    bubble.append(actions);

    row.append(role, bubble);
    els.messages.append(row);
  });

  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderThinking() {
  const thinking = document.createElement('article');
  thinking.className = 'message assistant thinking-row';
  thinking.innerHTML = `
    <div class="role">AI</div>
    <div class="bubble thinking">
      <span></span><span></span><span></span>
    </div>
  `;
  els.messages.append(thinking);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderStatus() {
  const hasEndpoint = Boolean(settings.endpoint.trim());
  els.statusDot.classList.toggle('ready', hasEndpoint);
  els.statusText.textContent = hasEndpoint ? 'API подключен' : 'API не настроен';
  els.hintText.textContent = hasEndpoint
    ? 'Enter отправляет, Shift+Enter переносит строку.'
    : 'Добавьте endpoint и ключ в API_CONFIG_PLACEHOLDER в app-core.js.';
}

function startTyping(messageId, content) {
  typingMessageId = messageId;
  const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) return;

  const actions = bubble.querySelector('.bubble-actions');
  bubble.textContent = '';
  if (actions) bubble.append(actions);

  let index = 0;
  const tick = () => {
    const visible = content.slice(0, index);
    const textNode = document.createTextNode(visible);
    bubble.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    });
    bubble.prepend(textNode);
    els.messages.scrollTop = els.messages.scrollHeight;

    if (index >= content.length) {
      typingMessageId = null;
      if (typingTimer) window.clearTimeout(typingTimer);
      typingTimer = null;
      renderMessages();
      return;
    }

    index += content.length > 1200 ? 6 : 3;
    typingTimer = window.setTimeout(tick, TYPE_SPEED_MS);
  };

  tick();
}

function stopTyping() {
  if (typingTimer) window.clearTimeout(typingTimer);
  typingTimer = null;
  typingMessageId = null;
}

function setBusy(isBusy) {
  els.sendBtn.disabled = isBusy;
  els.stopBtn.disabled = !isBusy;
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.chats && Array.isArray(parsed.chats)) return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return createInitialState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeText(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}
