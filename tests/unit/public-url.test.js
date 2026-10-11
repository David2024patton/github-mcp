import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { publicHttpsUrl, publicIpv4, resolvePublicIpv4, downloadPublicAsset } from '../../src/github/public-url.js';

describe('G-5 public asset URL boundary', () => {
  it('rejects unsafe schemes, credentials, ports, localhost and literal IPs', () => {
    for (const url of [
      'http://files.example.org/release.zip', 'https://127.0.0.1/file',
      'https://[::1]/file', 'https://localhost/file', 'https://foo.internal/file',
      'https://person:pass@files.example.org/file', 'https://files.example.org:8443/file',
      'https://files.example.org/file#frag', 'https://169.254.169.254/latest'
    ]) expect(() => publicHttpsUrl(url)).toThrow();
    expect(publicHttpsUrl('https://assets.example.org/file?version=1').hostname).toBe('assets.example.org');
  });
  it('refuses private, shared, reserved and metadata addresses', () => {
    for (const addr of ['0.0.0.0', '10.2.3.4', '127.0.0.1', '100.100.100.100', '169.254.169.254',
      '172.17.0.1', '192.168.1.1', '198.18.0.1', '192.0.2.1', '203.0.113.4', '224.0.0.1', '::ffff:127.0.0.1'])
      expect(publicIpv4(addr)).toBe(false);
    expect(publicIpv4('8.8.8.8')).toBe(true);
  });
  it('pins a public A record and rejects mixed public/private DNS answers', async () => {
    await expect(resolvePublicIpv4('asset.example', async () =>
      [{ address: '8.8.8.8' }, { address: '10.0.0.2' }])).rejects.toThrow(/private/);
    expect(await resolvePublicIpv4('asset.example', async () => [{ address: '8.8.8.8' }])).toBe('8.8.8.8');
  });
  const fakeRequest = (status, chunks, headers = {}) => vi.fn((_url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const response = Readable.from(chunks);
      response.statusCode = status;
      response.headers = headers;
      callback(response);
    });
    // The injected IP pin must be used instead of a second unvalidated DNS resolution.
    options.lookup('assets.example.org', {}, (_err, ip) => expect(ip).toBe('8.8.8.8'));
    return req;
  });
  const safe = 'https://assets.example.org/build.zip';
  const resolve = async () => '8.8.8.8';
  it('streams a bounded file without following a redirect or leaking data in results', async () => {
    const request = fakeRequest(200, [Buffer.from('a'), Buffer.from('bc')], { 'content-type': 'application/zip' });
    const result = await downloadPublicAsset(safe, { resolve, request });
    expect(result.size).toBe(3);
    expect(result.bytes.toString()).toBe('abc');
    expect(result.contentType).toBe('application/zip');
  });
  it('refuses redirects, oversized content-length and streaming overflow', async () => {
    await expect(downloadPublicAsset(safe, { resolve, request: fakeRequest(302, [], { location: 'https://localhost/x' }) }))
      .rejects.toThrow(/redirect/);
    await expect(downloadPublicAsset(safe, { resolve, request: fakeRequest(200, [], { 'content-length': '101' }), maxBytes: 100 }))
      .rejects.toThrow(/size limit/);
    await expect(downloadPublicAsset(safe, { resolve, request: fakeRequest(200, [Buffer.alloc(70), Buffer.alloc(40)]), maxBytes: 100 }))
      .rejects.toThrow(/streaming limit/);
  });
});
