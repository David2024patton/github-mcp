// PAR-1: search GitHub's own help pages (docs.github.com). This is the ONE deliberate exception to "GitHub only through client.js":
// it is not the GitHub API, needs no credential and sends none, and nothing about the person or their accounts is sent.
// Fixed origin and path only; the query is added with URLSearchParams, never by string concatenation.
const ORIGIN = 'https://docs.github.com';
const SEARCH_PATH = '/api/search/v1';
const MESSAGE = "GitHub's help search did not answer; try again or search https://docs.github.com yourself.";
const strip = (text) => String(text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const clip = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text);

export function docsSearchUrl(query, size) {
  const url = new URL(SEARCH_PATH, ORIGIN);
  url.searchParams.set('version', 'dotcom');
  url.searchParams.set('language', 'en');
  url.searchParams.set('query', query);
  url.searchParams.set('size', String(size));
  return url;
}

/** @returns {Promise<{ total: number, items: Array<{ title: string, url: string, breadcrumbs: string, snippet: string }> }>} */
export async function searchDocs({ query, max = 5, fetch: doFetch = globalThis.fetch }) {
  const url = docsSearchUrl(query, max);
  let body;
  for (let attempt = 1; attempt <= 2; attempt += 1) { // at most one retry
    try {
      const res = await doFetch(url.toString(), { redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'robinson-github-mcp' }, signal: AbortSignal.timeout(8000) });
      if (res.url && new URL(res.url).origin !== ORIGIN) throw new TypeError(MESSAGE);
      if (!res.ok) throw new TypeError(MESSAGE);
      body = await res.json();
      break;
    } catch {
      if (attempt === 2) throw new TypeError(MESSAGE);
    }
  }
  const hits = Array.isArray(body?.hits) ? body.hits : [];
  // GitHub answers with site-relative links ("/en/rest/..."); resolve them against the fixed origin and keep only docs.github.com.
  const absolute = (value) => { try { const u = new URL(value, ORIGIN); return u.origin === ORIGIN ? u.href : null; } catch { return null; } };
  const items = hits.map((h) => ({ h, url: typeof h?.url === 'string' ? absolute(h.url) : null })).filter((x) => x.url).slice(0, max).map(({ h, url }) => ({
    title: clip(strip(h.title), 200), url,
    breadcrumbs: clip(strip(Array.isArray(h.breadcrumbs) ? h.breadcrumbs.join(' > ') : h.breadcrumbs), 200),
    snippet: clip(strip(Array.isArray(h.highlights?.content) ? h.highlights.content[0] : h.highlights?.content), 300)
  }));
  return { total: Number(body?.meta?.found?.value ?? items.length), items };
}
