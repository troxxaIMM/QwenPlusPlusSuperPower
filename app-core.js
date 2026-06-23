export const API_CONFIG_PLACEHOLDER = {
  endpoint: '/api/chat',
  apiKey: '',
  model: 'qwen-hauhau',
};

export const DEFAULT_CUSTOM_TEMPLATE = `{
  "model": "{{model}}",
  "prompt": "{{prompt}}",
  "messages": {{messages}},
  "temperature": {{temperature}},
  "top_p": {{topP}},
  "max_tokens": {{maxTokens}}
}`;

export const DEFAULT_SETTINGS = {
  endpoint: API_CONFIG_PLACEHOLDER.endpoint,
  apiKey: API_CONFIG_PLACEHOLDER.apiKey,
  model: API_CONFIG_PLACEHOLDER.model,
  mode: 'openai',
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4000,
  customTemplate: DEFAULT_CUSTOM_TEMPLATE,
};

export function createInitialState() {
  return {
    activeChatId: null,
    chats: [],
  };
}

export function createChat(state, title = 'Новый чат') {
  const chat = {
    id: createId('chat'),
    title: normalizeTitle(title),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  return {
    ...state,
    activeChatId: chat.id,
    chats: [...state.chats, chat],
  };
}

export function renameChat(state, chatId, title) {
  const nextTitle = normalizeTitle(title);
  return {
    ...state,
    chats: state.chats.map((chat) =>
      chat.id === chatId ? { ...chat, title: nextTitle, updatedAt: new Date().toISOString() } : chat,
    ),
  };
}

export function deleteChat(state, chatId) {
  const chats = state.chats.filter((chat) => chat.id !== chatId);
  const activeChatId = state.activeChatId === chatId ? chats.at(-1)?.id ?? null : state.activeChatId;
  return { ...state, chats, activeChatId };
}

export function setActiveChat(state, chatId) {
  if (!state.chats.some((chat) => chat.id === chatId)) return state;
  return { ...state, activeChatId: chatId };
}

export function appendMessage(state, chatId, message) {
  const normalizedMessage = {
    id: createId('msg'),
    role: message.role,
    content: String(message.content ?? ''),
    createdAt: new Date().toISOString(),
    error: Boolean(message.error),
  };

  return {
    ...state,
    chats: state.chats.map((chat) =>
      chat.id === chatId
        ? {
            ...chat,
            updatedAt: new Date().toISOString(),
            messages: [...chat.messages, normalizedMessage],
          }
        : chat,
    ),
  };
}

export function updateSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    temperature: toNumber(settings.temperature, DEFAULT_SETTINGS.temperature),
    topP: toNumber(settings.topP, DEFAULT_SETTINGS.topP),
    maxTokens: Math.max(1, Math.round(toNumber(settings.maxTokens, DEFAULT_SETTINGS.maxTokens))),
  };
}

export function buildOpenAIRequestBody({ model, messages, temperature, topP, maxTokens }) {
  return {
    model,
    messages: messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .map((message) => ({ role: message.role, content: String(message.content ?? '') })),
    temperature: toNumber(temperature, DEFAULT_SETTINGS.temperature),
    top_p: toNumber(topP, DEFAULT_SETTINGS.topP),
    max_tokens: Math.max(1, Math.round(toNumber(maxTokens, DEFAULT_SETTINGS.maxTokens))),
    stream: false,
  };
}

export function buildCustomRequestBody({
  template,
  model = DEFAULT_SETTINGS.model,
  messages,
  temperature,
  topP,
  maxTokens,
}) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const values = {
    model,
    prompt: lastUserMessage?.content ?? '',
    messages: JSON.stringify(
      messages
        .filter((message) => ['user', 'assistant'].includes(message.role))
        .map(({ role, content }) => ({ role, content })),
    ),
    temperature: String(toNumber(temperature, DEFAULT_SETTINGS.temperature)),
    topP: String(toNumber(topP, DEFAULT_SETTINGS.topP)),
    maxTokens: String(Math.max(1, Math.round(toNumber(maxTokens, DEFAULT_SETTINGS.maxTokens)))),
  };

  const rendered = Object.entries(values).reduce((body, [key, value]) => {
    const token = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    const replacement = ['messages', 'temperature', 'topP', 'maxTokens'].includes(key)
      ? value
      : escapeJsonString(value);
    return body.replace(token, replacement);
  }, template || DEFAULT_CUSTOM_TEMPLATE);

  return JSON.parse(rendered);
}

export function extractAssistantReply(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload.choices?.[0]?.message?.content) return payload.choices[0].message.content;
  if (payload.choices?.[0]?.text) return payload.choices[0].text;
  if (payload.message?.content) return payload.message.content;
  if (payload.response) return payload.response;
  if (payload.text) return payload.text;
  if (payload.output) return Array.isArray(payload.output) ? payload.output.join('\n') : payload.output;
  return JSON.stringify(payload, null, 2);
}

export function getActiveChat(state) {
  return state.chats.find((chat) => chat.id === state.activeChatId) ?? null;
}

function normalizeTitle(title) {
  const clean = String(title ?? '').trim();
  return clean || 'Новый чат';
}

function createId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeJsonString(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}
