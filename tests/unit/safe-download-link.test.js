import { describe, expect, it } from 'vitest';
import { safeGithubDownloadRedirect, githubDownloadPage } from '../../src/tools/safe-download-link.js';

describe('no bearer redirect in AI-visible archive links', () => {
  const human = 'https://github.com/example-org/hello';
  it('preserves only clean codeload redirects', () => {
    const url = 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main';
    expect(safeGithubDownloadRedirect(url, human)).toEqual({ url, sensitive_redirect_omitted: false });
  });
  it('withholds query, fragments, userinfo, untrusted or non-HTTPS origins and hidden signed paths', () => {
    for (const url of [
      'https://codeload.github.com/example-org/hello/legacy.tar.gz/main?sig=bearer-secret',
      'https://codeload.github.com/example-org/hello/legacy.tar.gz/main#private',
      'https://admin:pass@codeload.github.com/example-org/hello/legacy.tar.gz/main',
      'http://codeload.github.com/example-org/hello/legacy.tar.gz/main',
      'https://evil.example/x?secret=bearer-secret',
      'https://pipelines.actions.githubusercontent.com/private/blob?sig=bearer-secret',
      'https://codeload.github.com/example-org/hello/secret-token/in-path',
      'https://codeload.github.com:8443/example-org/hello/legacy.tar.gz/main',
      'https://codeload.github.com/example-org/hello/legacy.tar.gz/%73igned-token'
    ]) {
      const result = safeGithubDownloadRedirect(url, human);
      expect(result.url).toBeNull();
      expect(result.sensitive_redirect_omitted).toBe(true);
      expect(result.github_web_url).toBe(human);
      expect(JSON.stringify(result)).not.toContain('bearer-secret');
      expect(JSON.stringify(result)).not.toContain('admin:pass');
    }
  });
  it('refuses missing/malformed provider Location generically without logging its source', () => {
    expect(() => safeGithubDownloadRedirect('', human)).toThrow(/download address/);
    expect(() => safeGithubDownloadRedirect('not a URL', human)).toThrow(/valid download address/);
  });
  it('does not construct unsafe human navigation from user-controlled repository text', () => {
    expect(githubDownloadPage('example-org', 'hello', 'actions')).toBe('https://github.com/example-org/hello/actions');
    expect(githubDownloadPage('example-org', 'hello?token=bad')).toBe('https://github.com');
    expect(githubDownloadPage('bad@owner', 'hello')).toBe('https://github.com');
  });
});
