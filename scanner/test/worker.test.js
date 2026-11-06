// Runs the worker against a fake Anthropic API to check requests, auth and error handling.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import worker from '../src/index.js';

let server, baseURL, nextReply, lastRequest;

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(body) };
    const { status = 200, json } = nextReply;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ORIGIN = 'https://jaygit88.github.io';
const env = () => ({ ANTHROPIC_API_KEY: 'sk-test', APP_PASSCODE: 'pikachu', ALLOWED_ORIGINS: ORIGIN, ANTHROPIC_BASE_URL: baseURL });
const card = { position: 1, pokemon: 'Umbreon', dex_number: 197, card_name: 'Umbreon ex', set_code: 'PRE', number: '161', set_total: '131', language: 'EN', confidence: 'high' };
const message = (cards, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: extra.model || 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify({ cards }) }],
  stop_reason: extra.stop_reason || 'end_turn', usage: { input_tokens: 1200, output_tokens: 300 },
});
const call = (body, { pass = 'pikachu', method = 'POST', path = '/identify' } = {}) => worker.fetch(new Request(`https://scanner.example${path}`, {
  method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-App-Passcode': pass },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
}), env());

test('quick scan uses Haiku 5.5 without fallbacks and returns the card', async () => {
  nextReply = { json: message([card]) };
  const res = await call({ mode: 'quick', image: 'AAAA' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  const data = await res.json();
  assert.deepEqual(data.cards, [card]);
  assert.equal(lastRequest.body.model, 'claude-haiku-5-5');
  assert.equal(lastRequest.body.output_config.effort, 'low');
  assert.equal(lastRequest.body.output_config.format.type, 'json_schema');
  assert.equal(lastRequest.body.fallbacks, undefined);
  assert.equal(lastRequest.body.messages[0].content[0].source.data, 'AAAA');
  assert.ok(lastRequest.headers['x-api-key'] === 'sk-test' || lastRequest.headers.authorization === 'Bearer sk-test', 'API key is sent');
});

test('catalogue scan uses Sonnet 5.5 with the default fallback and returns all 12 cards of a 12-pocket page', async () => {
  nextReply = { json: message(Array.from({ length: 12 }, (_, i) => ({ ...card, position: i + 1 })), { model: 'claude-sonnet-5-5' }) };
  const res = await call({ mode: 'catalog', image: 'data:image/jpeg;base64,BBBB', pockets: 12 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cards.length, 12);
  assert.match(lastRequest.body.messages[0].content[1].text, /12 pockets: 3 across and 4 down/);
  assert.equal(lastRequest.body.model, 'claude-sonnet-5-5');
  assert.equal(lastRequest.body.fallbacks, 'default');
  assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(lastRequest.body.messages[0].content[0].source.data, 'BBBB', 'data: prefix is stripped');
});

test('wrong passcode is rejected before calling Anthropic', async () => {
  lastRequest = null;
  const res = await call({ mode: 'quick', image: 'AAAA' }, { pass: 'nope' });
  assert.equal(res.status, 401);
  assert.equal(lastRequest, null);
});

test('bad mode and missing image are rejected', async () => {
  assert.equal((await call({ mode: 'other', image: 'AAAA' })).status, 400);
  assert.equal((await call({ mode: 'quick', image: '' })).status, 400);
});

test('a refusal becomes a friendly 422', async () => {
  nextReply = { json: message([], { stop_reason: 'refusal' }) };
  const res = await call({ mode: 'quick', image: 'AAAA' });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /couldn't read/);
});

test('an invalid API key is reported clearly', async () => {
  nextReply = { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  const res = await call({ mode: 'quick', image: 'AAAA' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /API key/);
});

test('CORS preflight and health check work', async () => {
  const pre = await worker.fetch(new Request('https://scanner.example/identify', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env());
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /X-App-Passcode/);
  const health = await call(null, { method: 'GET', path: '/' });
  assert.equal(health.status, 200);
});

test('catalogue scan without a known layout still allows up to 16 cards', async () => {
  nextReply = { json: message(Array.from({ length: 20 }, (_, i) => ({ ...card, position: i + 1 })), { model: 'claude-sonnet-5-5' }) };
  const res = await call({ mode: 'catalog', image: 'CCCC', pockets: 7 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cards.length, 16);
  assert.doesNotMatch(lastRequest.body.messages[0].content[1].text, /pockets:/);
});
