import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Webhooks } from '@octokit/webhooks';
import { forwarderUrl, sendSigned, signBody } from '../../src/dev/forward-sender.js';

const SECRET = 'f'.repeat(64);
const URL_OK = 'https://app.example.org/hooks/github?token=abc';
const resolve = async () => '8.8.8.8';
function fakeRequest({ status = 200, error = null, capture = {} } = {}) {
  return vi.fn((url, options, callback) => {
    const req = new EventEmitter();
    capture.url = url; capture.options = options;
    req.end = (body) => queueMicrotask(() => {
      capture.body = body;
      options.lookup(url.hostname, {}, (_e, ip) => { capture.ip = ip; });
      if (error) return req.emit('error', error);
      const response = Readable.from(['ok']);
      response.statusCode = status;
      callback(response);
    });
    return req;
  });
}

describe('V-4 forwarder URL policy', () => {
  it('accepts public HTTPS and refuses everything private, local, plain or credentialed without echoing the address', () => {
    expect(forwarderUrl(URL_OK).hostname).toBe('app.example.org');
    for (const bad of ['http://app.example.org/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://svc.internal/x', 'https://user:pw@app.example.org/x',
      'https://app.example.org:8443/x', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/x', 'not a url', 'https://app.example.org/x#frag']) {
      let message = '';
      try { forwarderUrl(bad); } catch (error) { message = error.message; }
      expect(message).toMatch(/public HTTPS/);
      expect(message).not.toContain('meta-data');
    }
  });
});

describe('V-4 signed sender', () => {
  it('re-sends the exact body with the original event, a fresh delivery ID and a signature @octokit/webhooks verifies', async () => {
    const capture = {};
    const body = JSON.stringify({ action: 'opened', number: 7, note: 'ünïcode ✓' });
    const result = await sendSigned({ url: URL_OK, event: 'pull_request', body, secret: SECRET, resolve, request: fakeRequest({ capture }) });
    expect(result).toEqual({ outcome: 'delivered', status: 200 });
    const h = capture.options.headers;
    expect(h['X-GitHub-Event']).toBe('pull_request');
    expect(h['X-GitHub-Delivery']).toMatch(/^[0-9a-f-]{36}$/);
    expect(h['Content-Length']).toBe(Buffer.byteLength(body));
    expect(capture.body.toString('utf8')).toBe(body);
    expect(await new Webhooks({ secret: SECRET }).verify(capture.body.toString('utf8'), h['X-Hub-Signature-256'])).toBe(true);
    expect(await new Webhooks({ secret: 'wrong' }).verify(body, h['X-Hub-Signature-256'])).toBe(false);
    expect(h['X-Hub-Signature-256']).toBe(signBody(SECRET, Buffer.from(body)));
    expect(capture.ip).toBe('8.8.8.8');
    expect(capture.options.method).toBe('POST');
    const second = {};
    await sendSigned({ url: URL_OK, event: 'push', body, secret: SECRET, resolve, request: fakeRequest({ capture: second }) });
    expect(second.options.headers['X-GitHub-Delivery']).not.toBe(h['X-GitHub-Delivery']);
  });
  it('refuses a name that resolves to a private address before any connection is made', async () => {
    const request = fakeRequest();
    const blocked = await sendSigned({ url: URL_OK, event: 'push', body: '{}', secret: SECRET, request, resolve: async () => { throw new TypeError('private'); } });
    expect(blocked.outcome).toBe('blocked');
    expect(request).not.toHaveBeenCalled();
    await expect(sendSigned({ url: 'https://10.0.0.1/x', event: 'push', body: '{}', secret: SECRET, request, resolve })).rejects.toThrow(/public HTTPS/);
    expect(request).not.toHaveBeenCalled();
  });
  it('refuses redirects, reports other statuses, and never retries a timeout or a lost connection', async () => {
    const redirect = fakeRequest({ status: 302 });
    expect(await sendSigned({ url: URL_OK, event: 'push', body: '{}', secret: SECRET, resolve, request: redirect })).toEqual({ outcome: 'redirect_refused', status: 302 });
    expect(redirect).toHaveBeenCalledTimes(1);
    expect((await sendSigned({ url: URL_OK, event: 'push', body: '{}', secret: SECRET, resolve, request: fakeRequest({ status: 500 }) }))).toEqual({ outcome: 'rejected_by_target', status: 500 });
    const abort = fakeRequest({ error: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    expect((await sendSigned({ url: URL_OK, event: 'push', body: '{}', secret: SECRET, resolve, request: abort })).outcome).toBe('timeout_unconfirmed');
    expect(abort).toHaveBeenCalledTimes(1);
    const reset = fakeRequest({ error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    expect((await sendSigned({ url: URL_OK, event: 'push', body: '{}', secret: SECRET, resolve, request: reset })).outcome).toBe('error_unconfirmed');
  });
  it('refuses a payload over 1 MB without contacting the target', async () => {
    const request = fakeRequest();
    const out = await sendSigned({ url: URL_OK, event: 'push', body: JSON.stringify({ big: 'x'.repeat(1024 * 1024 + 10) }), secret: SECRET, resolve, request });
    expect(out.outcome).toBe('blocked');
    expect(request).not.toHaveBeenCalled();
  });
});
