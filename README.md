# Qwen AI Console

Multi-chat UI for a self-hosted AI model.

## Where to add API details

- Frontend calls `/api/chat`.
- Server forwards requests to `QWEN_API_URL`.
- Server reads the key from `QWEN_API_KEY`.

The API key is intentionally not shipped in frontend code.
The model's own prompt is used; this site does not send a separate system prompt.

## Render deployment

Recommended Web Service settings:

- Root Directory: `outputs/ai-chat-site`
- Build Command: empty
- Start Command: `node server.js`

Environment variables:

- `QWEN_API_URL`: `http://136.59.129.136:35010/qwen/v1/chat/completions`
- `QWEN_API_KEY`: your API key

## API modes

- OpenAI-compatible: sends `model`, `messages`, `temperature`, `top_p`, `max_tokens`, and `stream: false`.
- Custom JSON: edit `DEFAULT_CUSTOM_TEMPLATE` and `mode` in `app-core.js`.
