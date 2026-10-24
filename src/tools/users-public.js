// Y-3 (WU-Y3a): read other accounts' public data. All reads; nothing here can write. See public-read.js for the rules.
import { defineRead } from './define-read.js';
import { cap, publicGet, readerClient, actorOf, shapeAccount, shapeRepo, LOGIN, REPO_NAME, MAX, NOT_FOUND } from './public-read.js';
import { plain } from './github-read.js';

const AS = { ...LOGIN, description: 'Which of your connected accounts reads (default account)' };
const USERNAME = { ...LOGIN, description: 'Any public GitHub user or organization' };
const PAGE = { type: 'integer', minimum: 1, maximum: 100, description: 'Page number (default 1)' };
const client = async (args, ctx) => readerClient(ctx, actorOf(args, ctx));

/** The repository must be public; a private or missing one gives the same answer. */
async function publicRepo(c, args) {
  const repo = await publicGet(c, 'GET /repos/{owner}/{repo}', { owner: args.owner, repo: args.repo });
  if (repo.private === true || (repo.visibility && repo.visibility !== 'public')) throw new TypeError(NOT_FOUND);
  return repo;
}

const userGet = defineRead({
  name: 'github_user_get', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'Read any public GitHub user or organization profile: name, bio, counts, links. Free text is marked untrusted.',
  properties: { as: AS, username: USERNAME }, required: ['username'],
  handler: (args, ctx) => plain(async () => shapeAccount(await publicGet(await client(args, ctx), 'GET /users/{username}', { username: args.username })))
});

const userRepos = defineRead({
  name: 'github_user_list_repos', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'List a user\'s or organization\'s public repositories with language, stars and topics.',
  properties: { as: AS, username: USERNAME, type: { type: 'string', enum: ['owner', 'member', 'all'] }, sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'] }, max: MAX, page: PAGE },
  required: ['username'],
  handler: (args, ctx) => plain(async () => {
    const rows = await publicGet(await client(args, ctx), 'GET /users/{username}/repos', { username: args.username, type: args.type ?? 'owner', sort: args.sort ?? 'pushed', per_page: args.max ?? 30, page: args.page ?? 1 });
    return { items: rows.filter((r) => r.private !== true).map(shapeRepo), page: args.page ?? 1 };
  })
});

const userSocial = defineRead({
  name: 'github_user_list_social', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'List the social links (provider and URL) on any public GitHub profile.',
  properties: { as: AS, username: USERNAME }, required: ['username'],
  handler: (args, ctx) => plain(async () => {
    const rows = await publicGet(await client(args, ctx), 'GET /users/{username}/social_accounts', { username: args.username });
    return { items: rows.slice(0, 20).map((s) => ({ provider: s.provider, url: cap(s.url, 300) })), untrusted: true };
  })
});

const person = (u) => ({ login: u.login, id: u.id, type: u.type, html_url: u.html_url });
const followers = defineRead({
  name: 'github_user_list_followers', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'List the public followers of any GitHub user or organization.',
  properties: { as: AS, username: USERNAME, max: MAX, page: PAGE }, required: ['username'],
  handler: (args, ctx) => plain(async () => ({
    items: (await publicGet(await client(args, ctx), 'GET /users/{username}/followers', { username: args.username, per_page: args.max ?? 30, page: args.page ?? 1 })).map(person), page: args.page ?? 1
  }))
});
const following = defineRead({
  name: 'github_user_list_following', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'List the people a GitHub user publicly follows.',
  properties: { as: AS, username: USERNAME, max: MAX, page: PAGE }, required: ['username'],
  handler: (args, ctx) => plain(async () => ({
    items: (await publicGet(await client(args, ctx), 'GET /users/{username}/following', { username: args.username, per_page: args.max ?? 30, page: args.page ?? 1 })).map(person), page: args.page ?? 1
  }))
});

const publicRepoGet = defineRead({
  name: 'github_public_repo_get', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'Read a PUBLIC repository of any account with a capped README excerpt. Private or missing gives the same answer.',
  properties: { as: AS, owner: USERNAME, repo: REPO_NAME }, required: ['owner', 'repo'],
  handler: (args, ctx) => plain(async () => {
    const c = await client(args, ctx);
    const repo = await publicRepo(c, args);
    let readme = null;
    try {
      const file = await publicGet(c, 'GET /repos/{owner}/{repo}/readme', { owner: args.owner, repo: args.repo });
      readme = { name: file.name, excerpt: cap(Buffer.from(String(file.content ?? ''), file.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8'), 2000), size: file.size, untrusted: true };
    } catch { readme = null; }
    return { ...shapeRepo(repo), readme };
  })
});

const KINDS = {
  contents: 'GET /repos/{owner}/{repo}/contents', releases: 'GET /repos/{owner}/{repo}/releases', issues: 'GET /repos/{owner}/{repo}/issues', pulls: 'GET /repos/{owner}/{repo}/pulls'
};
const publicRepoList = defineRead({
  name: 'github_public_repo_list', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'List contents, releases, issues or pull requests of a PUBLIC repository of any account. Text is untrusted data.',
  properties: { as: AS, owner: USERNAME, repo: REPO_NAME, kind: { type: 'string', enum: Object.keys(KINDS) },
    path: { type: 'string', maxLength: 300, description: 'Folder for kind contents (default the root)' }, state: { type: 'string', enum: ['open', 'closed', 'all'] }, max: MAX, page: PAGE },
  required: ['owner', 'repo', 'kind'],
  handler: (args, ctx) => plain(async () => {
    const c = await client(args, ctx);
    await publicRepo(c, args);
    const base = { owner: args.owner, repo: args.repo };
    const paging = { per_page: args.max ?? 30, page: args.page ?? 1 };
    let items;
    if (args.kind === 'contents') {
      const route = args.path ? 'GET /repos/{owner}/{repo}/contents/{path}' : KINDS.contents;
      const data = await publicGet(c, route, { ...base, ...(args.path ? { path: args.path } : {}) });
      items = (Array.isArray(data) ? data : [data]).slice(0, args.max ?? 30).map((f) => ({ name: f.name, path: f.path, type: f.type, size: f.size, html_url: f.html_url }));
    } else if (args.kind === 'releases') {
      items = (await publicGet(c, KINDS.releases, { ...base, ...paging })).map((r) => ({ tag: r.tag_name, name: cap(r.name, 120), draft: r.draft, prerelease: r.prerelease, published_at: r.published_at, html_url: r.html_url, body: cap(r.body, 500), untrusted: true }));
    } else {
      const rows = await publicGet(c, KINDS[args.kind], { ...base, state: args.state ?? 'open', ...paging });
      items = rows.map((i) => ({ number: i.number, title: cap(i.title, 200), state: i.state, user: i.user?.login ?? null, created_at: i.created_at, html_url: i.html_url, pull_request: args.kind === 'pulls' || Boolean(i.pull_request), body: cap(i.body, 400), untrusted: true }));
    }
    return { kind: args.kind, items, page: args.page ?? 1 };
  })
});

// PAR-1: who starred a public repository. Public repositories only (the same rule as github_public_repo_get): a private or missing
// repository gives the one not-found answer. `withDates` asks GitHub for the star timestamps.
const stargazers = defineRead({
  name: 'github_repo_list_stargazers', area: 'user', audience: ['B', 'O', 'Op'],
  description: 'List the people who starred a PUBLIC repository, with the total and optionally when each starred.',
  properties: { as: AS, owner: USERNAME, repo: REPO_NAME, max: MAX, page: PAGE, withDates: { type: 'boolean', description: 'Include when each person starred' } },
  required: ['owner', 'repo'],
  handler: (args, ctx) => plain(async () => {
    const c = await client(args, ctx);
    await publicRepo(c, args);
    const base = { owner: args.owner, repo: args.repo };
    const total = await publicGet(c, 'GET /repos/{owner}/{repo}/stargazers/count', base);
    const rows = await publicGet(c, 'GET /repos/{owner}/{repo}/stargazers', { ...base, per_page: args.max ?? 30, page: args.page ?? 1,
      ...(args.withDates ? { headers: { accept: 'application/vnd.github.star+json' } } : {}) });
    return { total: typeof total === 'number' ? total : Number(total?.count ?? rows.length), page: args.page ?? 1,
      items: rows.map((row) => { const u = row.user ?? row; return { login: u.login, type: u.type, ...(args.withDates ? { starred_at: row.starred_at ?? null } : {}) }; }) };
  })
});

const all = [userGet, userRepos, userSocial, followers, following, publicRepoGet, publicRepoList, stargazers];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
