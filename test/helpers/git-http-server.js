// A throwaway git server for tests: a bare repository served by the real `git http-backend`, listening on 127.0.0.1.
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString();

export async function startGitServer({ pages = { 'Home.md': '# Home\n' }, owner = 'example-org', repo = 'app' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
  const bare = path.join(root, owner, `${repo}.wiki.git`);
  fs.mkdirSync(bare, { recursive: true });
  gitIn(bare, 'init', '--bare', '--initial-branch=master');
  gitIn(bare, 'config', 'http.receivepack', 'true');
  const work = path.join(root, 'work');
  gitIn(root, 'clone', bare, work);
  gitIn(work, 'checkout', '-B', 'master');
  for (const [name, text] of Object.entries(pages)) fs.writeFileSync(path.join(work, name), text);
  gitIn(work, 'add', '-A'); gitIn(work, 'commit', '-m', 'seed'); gitIn(work, 'push', 'origin', 'master');
  const backend = path.join(gitIn(root, '--exec-path').trim(), 'git-http-backend');
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seen.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization ?? null });
    const wantsAuth = url.pathname.endsWith('git-receive-pack') || url.search.includes('service=git-receive-pack');
    if (wantsAuth && !String(req.headers.authorization ?? '').startsWith('Basic ')) { req.resume(); res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }); res.end(); return; }
    const child = spawn(backend, [], { env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', REQUEST_METHOD: req.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] ?? '', CONTENT_LENGTH: req.headers['content-length'] ?? '', REMOTE_USER: 'x-access-token', REMOTE_ADDR: '127.0.0.1', GIT_COMMITTER_NAME: 'srv', GIT_COMMITTER_EMAIL: 'srv@example.com' } });
    req.pipe(child.stdin);
    const out = []; child.stdout.on('data', (c) => out.push(c));
    child.on('close', () => {
      const raw = Buffer.concat(out); const split = raw.indexOf('\r\n\r\n'); const head = raw.subarray(0, split).toString(); const body = raw.subarray(split + 4);
      let status = 200; const headers = {};
      for (const line of head.split('\r\n')) { const [k, ...v] = line.split(': '); if (k.toLowerCase() === 'status') status = Number(v.join(': ').split(' ')[0]); else headers[k] = v.join(': '); }
      res.writeHead(status, headers); res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  /** A fetch that sends github.com wiki URLs to this server and everything else to `other`. */
  const fetchVia = (other) => (input, init) => {
    const url = String(input?.url ?? input);
    if (url.startsWith('https://github.com/') && url.includes('.wiki.git/')) return fetch(url.replace('https://github.com', `http://127.0.0.1:${port}`), init);
    return other(input, init);
  };
  const seedHead = gitIn(bare, 'rev-parse', 'refs/heads/master').trim();
  /** Undo what the last push did (a server that says yes but does not keep the change). */
  const forgetPushes = () => gitIn(bare, 'update-ref', 'refs/heads/master', seedHead);
  const log = (...args) => gitIn(bare, ...args);
  return { fetchVia, forgetPushes, seen, log, bare, close: async () => { await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); } };
}
