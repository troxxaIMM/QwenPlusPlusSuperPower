import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const upstreamUrl = process.env.QWEN_API_URL || 'http://136.59.129.136:35010/qwen/v1/chat/completions';
const upstreamApiKey = process.env.QWEN_API_KEY || '';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'POST' && isChatRoute(url.pathname)) {
    await proxyChatRequest(request, response);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 404, {
      error: `Unknown API route: ${url.pathname}`,
    });
    return;
  }

  const requestedPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, requestedPath === '/' ? 'index.html' : requestedPath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    filePath = join(root, 'index.html');
  }

  if (statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  response.setHeader('Content-Type', types[extname(filePath)] || 'application/octet-stream');
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Qwen AI Console listening on port ${port}`);
});

async function proxyChatRequest(request, response) {
  if (!upstreamApiKey) {
    sendJson(response, 500, {
      error: 'QWEN_API_KEY is not configured on the server.',
    });
    return;
  }

  try {
    const body = unwrapTransportEnvelope(await readRequestBody(request));
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstreamApiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8';

    if (upstreamResponse.ok && contentType.includes('text/event-stream') && upstreamResponse.body) {
      response.writeHead(upstreamResponse.status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      for await (const chunk of upstreamResponse.body) {
        response.write(chunk);
      }

      response.end();
      return;
    }

    const text = await upstreamResponse.text();
    response.writeHead(upstreamResponse.status, {
      'Content-Type': contentType,
    });
    response.end(text);
  } catch (error) {
    sendJson(response, 502, {
      error: `Upstream request failed: ${error.message}`,
    });
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function unwrapTransportEnvelope(body) {
  const trimmedBody = body.trim();
  if (/^[A-Za-z0-9+/=_-]+$/.test(trimmedBody)) {
    try {
      const decoded = Buffer.from(trimmedBody, 'base64').toString('utf8');
      JSON.parse(decoded);
      return decoded;
    } catch {
      return body;
    }
  }

  try {
    const envelope = JSON.parse(body);
    if (envelope?.encoding === 'base64-json' && typeof envelope.payload === 'string') {
      return Buffer.from(envelope.payload, 'base64').toString('utf8');
    }
  } catch {
    return body;
  }

  return body;
}

function isChatRoute(pathname) {
  return ['/message', '/message/', '/api/chat', '/api/chat/'].includes(pathname);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
