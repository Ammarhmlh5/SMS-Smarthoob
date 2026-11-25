import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin } from '../backend/cors.mjs';
import { buildPostgrestQuery, LOCAL_USER_ID } from '../backend/query.mjs';

function params(value = '') {
  return new URLSearchParams(value);
}

test('local API allows the active Expo web port but rejects unrelated origins', () => {
  assert.equal(allowedOrigin('http://localhost:8083'), true);
  assert.equal(allowedOrigin('http://localhost:8084'), false);
  assert.equal(allowedOrigin('https://example.com:8083'), false);
  assert.equal(allowedOrigin(undefined), true);
});

test('select queries restrict rows to the local user and bind filter values', () => {
  const query = buildPostgrestQuery({
    table: 'message_templates',
    method: 'GET',
    searchParams: params('select=id,title&title=eq.Hello%27%20OR%201%3D1'),
  });

  assert.equal(
    query.text,
    'SELECT "id", "title" FROM "public"."message_templates" WHERE "title" = $1 AND "user_id" = $2',
  );
  assert.deepEqual(query.values, ["Hello' OR 1=1", LOCAL_USER_ID]);
});

test('upserts assign the local owner and only update allowlisted columns', () => {
  const query = buildPostgrestQuery({
    table: 'message_templates',
    method: 'POST',
    searchParams: params('select=id,title'),
    body: {
      id: 'template-id',
      title: 'Invoice',
      body: 'Hello',
      variable_mappings: { amount: { type: 'pdf-region', region: { left: 0.1 } } },
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });

  assert.match(query.text, /ON CONFLICT \("id"\) DO UPDATE SET "title" = EXCLUDED\."title", "body" = EXCLUDED\."body", "variable_mappings" = EXCLUDED\."variable_mappings"/);
  assert.match(query.text, /WHERE "message_templates"\."user_id" = '00000000-0000-4000-8000-000000000001'/);
  assert.deepEqual(query.values, [
    'template-id',
    'Invoice',
    'Hello',
    { amount: { type: 'pdf-region', region: { left: 0.1 } } },
    LOCAL_USER_ID,
  ]);
});

test('mutations reject unfiltered access and cross-user writes', () => {
  assert.throws(() => buildPostgrestQuery({
    table: 'campaigns',
    method: 'DELETE',
    searchParams: params(),
  }), /requires at least one filter/);

  assert.throws(() => buildPostgrestQuery({
    table: 'campaigns',
    method: 'POST',
    searchParams: params(),
    body: { name: 'Other user campaign', user_id: '00000000-0000-4000-8000-000000000002' },
  }), /only write the local user row/);
});

test('unknown tables and columns are rejected', () => {
  assert.throws(() => buildPostgrestQuery({
    table: 'users',
    method: 'GET',
    searchParams: params(),
  }), /Unsupported database table/);

  assert.throws(() => buildPostgrestQuery({
    table: 'message_templates',
    method: 'GET',
    searchParams: params('password=eq.secret'),
  }), /Unsupported database column/);
});
