import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { allowedOrigin } from './cors.mjs';
import { buildPostgrestQuery, LOCAL_USER_ID } from './query.mjs';

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_API_PORT || 3001);
const apiKey = 'local-postgres-api-key';
const accessToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJlbWFpbCI6ImxvY2FsQGxvY2FsaG9zdCIsImV4cCI6NDEwMjQ0NDgwMH0.bG9jYWw';
const user = {
  id: LOCAL_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'local@localhost',
  app_metadata: { provider: 'local', providers: ['local'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};
const configuredPort = Number(process.env.PGPORT || 5433);
const poolPort = configuredPort === 5432 ? 5433 : configuredPort;
const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: poolPort,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  connectionTimeoutMillis: 5000,
  max: 5,
});

function sendJson(response, status, value, origin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(JSON.stringify(value));
}

function sendError(response, status, message, origin, code = 'LOCAL_API_ERROR') {
  sendJson(response, status, { code, message }, origin);
}

async function readJson(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1_000_000) throw new Error('Request body exceeds 1 MB');
  }
  if (!text) return null;
  return JSON.parse(text);
}

function authSession() {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 2147483647,
    expires_at: 4102444800,
    refresh_token: 'local-postgres-refresh-token',
    user,
  };
}

async function handleRequest(request, response) {
  const origin = request.headers.origin;
  if (!allowedOrigin(origin)) {
    sendError(response, 403, 'Origin is not allowed by the local database API.', null, 'CORS_ORIGIN_DENIED');
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version',
      'Access-Control-Max-Age': '600',
    });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${host}:${port}`);
  const path = url.pathname;
  if (path === '/health' && request.method === 'GET') {
    try {
      await pool.query('SELECT 1');
      sendJson(response, 200, { status: 'ok' }, origin);
    } catch {
      sendError(response, 503, 'PostgreSQL is not reachable with the local configuration.', origin, 'DATABASE_UNAVAILABLE');
    }
    return;
  }

  if (request.headers.apikey !== apiKey) {
    sendError(response, 401, 'Invalid local API key.', origin, 'UNAUTHORIZED');
    return;
  }

  const body = await readJson(request);
  if (path === '/auth/v1/token' && request.method === 'POST') {
    sendJson(response, 200, authSession(), origin);
    return;
  }
  if (path === '/auth/v1/signup' && request.method === 'POST') {
    sendJson(response, 200, authSession(), origin);
    return;
  }
  if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    sendJson(response, 200, authSession(), origin);
    return;
  }
  if (path === '/auth/v1/user' && request.method === 'GET') {
    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      sendError(response, 401, 'A local session is required.', origin, 'UNAUTHORIZED');
      return;
    }
    sendJson(response, 200, user, origin);
    return;
  }
  if (path === '/auth/v1/logout' && request.method === 'POST') {
    response.writeHead(204, origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {});
    response.end();
    return;
  }

  if (path.startsWith('/rest/v1/')) {
    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      sendError(response, 401, 'A local session is required.', origin, 'UNAUTHORIZED');
      return;
    }
    const table = path.slice('/rest/v1/'.length);
    try {
      const query = buildPostgrestQuery({
        table,
        method: request.method,
        searchParams: url.searchParams,
        body,
        prefer: request.headers.prefer || '',
      });
      const result = await pool.query(query.text, query.values);
      if (!query.returnsRows) {
        response.writeHead(request.method === 'POST' ? 201 : 204, origin ? {
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
        } : {});
        response.end();
        return;
      }

      const rows = result.rows;
      const objectAccept = request.headers.accept?.includes('application/vnd.pgrst.object+json');
      if (objectAccept && rows.length !== 1) {
        sendError(response, 406, `Expected one row, received ${rows.length}.`, origin, 'PGRST116');
        return;
      }
      sendJson(response, request.method === 'POST' ? 201 : 200, objectAccept ? rows[0] : rows, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local database request failed.';
      const unavailable = /ECONNREFUSED|password authentication failed|database.*not exist|PostgreSQL.*not reachable/i.test(message);
      const status = unavailable
        ? 503
        : message.startsWith('Unsupported') || message.startsWith('Expected') ||
        message.includes('requires at least one filter') || message.includes('only write the local user')
        ? 400
        : 500;
      sendError(
        response,
        status,
        status === 503
          ? 'قاعدة PostgreSQL المحلية غير متاحة حالياً.'
          : status === 400
            ? message
            : 'The PostgreSQL request failed.',
        origin,
        status === 503 ? 'DATABASE_UNAVAILABLE' : 'LOCAL_API_ERROR',
      );
    }
    return;
  }

  sendError(response, 404, 'Local API route not found.', origin, 'NOT_FOUND');
}

async function start() {
  if (!process.env.PGDATABASE || !process.env.PGUSER || !process.env.PGPASSWORD) {
    console.error('Set PGDATABASE, PGUSER, and PGPASSWORD in the ignored .env.local file.');
  }
  if (process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) {
    try {
      const schema = await readFile(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
      await pool.query(schema);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PostgreSQL initialization failed.';
      console.error(`PostgreSQL unavailable; continuing in preview/auth mode: ${message}`);
    }
  }
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendError(response, 500, 'Local API request failed.', null);
      else response.destroy();
    });
  });
  server.listen(port, host, () => {
    console.log(`Local PostgreSQL API listening on http://${host}:${port}`);
  });
  server.on('close', () => void pool.end());
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unable to start the local PostgreSQL API.');
  void pool.end();
  process.exitCode = 1;
});
