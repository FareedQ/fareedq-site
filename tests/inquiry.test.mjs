/**
 * Tests for the inquiry endpoint (functions/api/inquiry.js).
 *
 *   node --test tests/
 *
 * Node's built-in test runner and assert — no dependencies. `fetch` is stubbed
 * so nothing leaves the machine.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/inquiry.js';

const ENV = {
  RESEND_API_KEY: 'test_key',
  INQUIRY_TO: 'hello@example.com',
  INQUIRY_FROM: 'FareedQ <enquiries@example.com>',
};

let sent;

function stubFetch({ ok = true, status = 200, body = '{}' } = {}) {
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return { ok, status, text: async () => body, json: async () => JSON.parse(body) };
  };
}

const post = (payload, env = ENV, headers = {}) =>
  onRequestPost({
    request: new Request('https://www.fareedq.com/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    }),
    env,
  });

const valid = { name: 'Alex Rivera', email: 'alex@example.com', message: 'I would like to talk.', elapsed: 9000 };

describe('inquiry endpoint', () => {
  beforeEach(() => stubFetch());
  afterEach(() => { delete globalThis.fetch; });

  test('accepts a valid enquiry and sends exactly one email', async () => {
    const res = await post(valid);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    const body = JSON.parse(sent[0].init.body);
    assert.deepEqual(body.to, ['hello@example.com']);
    assert.equal(body.reply_to, 'alex@example.com');
    assert.match(body.subject, /Alex Rivera/);
    assert.match(body.text, /I would like to talk\./);
    assert.equal(sent[0].init.headers.Authorization, 'Bearer test_key');
  });

  test('the API key never appears in the response body', async () => {
    const res = await post(valid);
    assert.doesNotMatch(await res.text(), /test_key/);
  });

  test('honeypot submissions report success without sending mail', async () => {
    const res = await post({ ...valid, company: 'Spam Co' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(sent.length, 0, 'no email should be sent for a honeypot hit');
  });

  test('submissions faster than the threshold are rejected', async () => {
    const res = await post({ ...valid, elapsed: 300 });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
    assert.equal(sent.length, 0);
  });

  test('a missing elapsed value is not treated as suspicious', async () => {
    const { elapsed, ...rest } = valid;
    const res = await post(rest);
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
  });

  test('rejects a missing name', async () => {
    const res = await post({ ...valid, name: '   ' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /name/i);
  });

  test('rejects an over-long name', async () => {
    const res = await post({ ...valid, name: 'x'.repeat(101) });
    assert.equal(res.status, 400);
    assert.equal(sent.length, 0);
  });

  for (const bad of ['', 'not-an-email', 'a@b', 'a b@example.com', 'a@example', '@example.com']) {
    test(`rejects invalid email: ${JSON.stringify(bad)}`, async () => {
      const res = await post({ ...valid, email: bad });
      assert.equal(res.status, 400);
      assert.equal(sent.length, 0);
    });
  }

  for (const good of ['a@b.co', 'first.last+tag@sub.example.org', "o'brien@example.com"]) {
    test(`accepts valid email: ${good}`, async () => {
      const res = await post({ ...valid, email: good });
      assert.equal(res.status, 200);
    });
  }

  test('message is optional', async () => {
    const res = await post({ ...valid, message: '' });
    assert.equal(res.status, 200);
    assert.match(JSON.parse(sent[0].init.body).text, /no message provided/);
  });

  test('rejects an over-long message', async () => {
    const res = await post({ ...valid, message: 'x'.repeat(4001) });
    assert.equal(res.status, 400);
    assert.equal(sent.length, 0);
  });

  test('rejects link-farm spam silently', async () => {
    const res = await post({ ...valid, message: 'see https://a.com https://b.com https://c.com' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(sent.length, 0);
  });

  test('does not misfire the spam filter on an ordinary message', async () => {
    const res = await post({ ...valid, message: 'I keep putting off a decision about my career.' });
    assert.equal(sent.length, 1);
  });

  test('escapes HTML in the email body', async () => {
    await post({ ...valid, name: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>' });
    const body = JSON.parse(sent[0].init.body);
    /* No raw tag from user input may survive: every < and > is escaped, so an
       injected tag is inert text rather than markup. */
    assert.doesNotMatch(body.html, /<script/);
    assert.doesNotMatch(body.html, /<img/);
    assert.match(body.html, /&lt;script&gt;/);
    assert.match(body.html, /&lt;img/);
  });

  test('escapes quotes in attribute context', async () => {
    await post({ ...valid, name: 'x" onmouseover="alert(1)' });
    const body = JSON.parse(sent[0].init.body);
    assert.doesNotMatch(body.html, /onmouseover="alert/);
    assert.match(body.html, /&quot;/);
  });

  test('strips newlines from header-bound values', async () => {
    await post({ ...valid, name: 'Alex\r\nBcc: victim@example.com' });
    const body = JSON.parse(sent[0].init.body);
    assert.doesNotMatch(body.subject, /[\r\n]/);
  });

  test('fails closed when RESEND_API_KEY is absent', async () => {
    const res = await post(valid, { INQUIRY_TO: 'hello@example.com' });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).ok, false);
    assert.equal(sent.length, 0);
  });

  test('fails closed when INQUIRY_TO is absent', async () => {
    const res = await post(valid, { RESEND_API_KEY: 'k' });
    assert.equal(res.status, 500);
    assert.equal(sent.length, 0);
  });

  test('surfaces an upstream failure without leaking detail', async () => {
    stubFetch({ ok: false, status: 422, body: '{"message":"domain not verified"}' });
    const res = await post(valid);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.doesNotMatch(body.error, /domain not verified/);
  });

  test('rejects malformed JSON', async () => {
    const res = await onRequestPost({
      request: new Request('https://www.fareedq.com/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      env: ENV,
    });
    assert.equal(res.status, 400);
  });

  test('rate limits once the KV counter is exhausted', async () => {
    const store = new Map();
    const env = {
      ...ENV,
      INQUIRY_RATE_KV: {
        get: async (k) => store.get(k) ?? null,
        put: async (k, v) => { store.set(k, v); },
      },
    };
    const headers = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 5; i++) {
      const res = await post(valid, env, headers);
      assert.equal(res.status, 200, `submission ${i + 1} should pass`);
    }
    const blocked = await post(valid, env, headers);
    assert.equal(blocked.status, 429);
    assert.equal(sent.length, 5, 'the blocked submission must not send mail');
  });

  test('a KV failure does not block a real enquiry', async () => {
    const env = {
      ...ENV,
      INQUIRY_RATE_KV: { get: async () => { throw new Error('kv down'); }, put: async () => {} },
    };
    const res = await post(valid, env, { 'CF-Connecting-IP': '203.0.113.8' });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
  });
});
