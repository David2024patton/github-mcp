// Keeping results small (C-1). Service-agnostic: no GitHub imports. A tool's raw result goes through, in order:
//   projectFields (only the dotted paths asked for) -> [the caller shapes it: secrets hidden, times, dollars] -> capText
//   (long text and logs cut, saying how much) -> fitToBudget (an oversize result becomes a preview). When anything was cut,
//   the caller keeps the full shaped result behind a handle (24 hours, same connection) that github_get_result pages through.
export const RULES = Object.freeze({ textLimit: 4000, logLines: 400, maxBytes: 8192, pageSize: 20, maxPageSize: 100 });
const LOG_KEYS = /^(log|logs|output|stdout|stderr)$/i;
const MAX_DEPTH = 12;

export const sizeOf = (value) => Buffer.byteLength(JSON.stringify(value) ?? 'null');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- fields: dotted paths; a path through a list applies to every element ----
function pickPath(value, parts) {
  if (!parts.length) return { found: true, value };
  if (Array.isArray(value)) {
    const found = value.map((item) => pickPath(item, parts));
    return found.some((f) => f.found) ? { found: true, value: found.map((f) => (f.found ? f.value : null)) } : { found: false };
  }
  if (!isObject(value) || !Object.hasOwn(value, parts[0])) return { found: false };
  const inner = pickPath(value[parts[0]], parts.slice(1));
  return inner.found ? { found: true, value: { [parts[0]]: inner.value }, leaf: parts.length === 1 } : { found: false };
}

function merge(into, from) {
  if (Array.isArray(into) && Array.isArray(from)) return into.map((item, i) => merge(item, from[i]));
  if (isObject(into) && isObject(from)) {
    const out = { ...into };
    for (const [k, v] of Object.entries(from)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  }
  return from ?? into;
}

/**
 * Keeps only the named dotted paths. `alsoKeep` names fields that stay whatever was asked for (safety marks); `twins` are suffixes
 * of companion fields that follow a requested one when present (`updated_at` brings `updated_at_local`).
 * @returns {{ value: any, unknown: string[] }}
 */
export function projectFields(value, fields, { alsoKeep = [], twins = [] } = {}) {
  if (!Array.isArray(fields) || !fields.length) return { value, unknown: [] };
  const unknown = [];
  let out = Array.isArray(value) ? value.map(() => ({})) : {};
  const take = (path, count) => {
    const picked = pickPath(value, String(path).split('.'));
    if (picked.found) out = merge(out, picked.value);
    else if (count) unknown.push(path);
  };
  for (const path of fields) {
    take(path, true);
    for (const suffix of twins) take(`${path}${suffix}`, false);
  }
  for (const path of alsoKeep) take(path, false);
  return { value: out, unknown };
}

// ---- text caps ----
/** Cuts long text and logs. @returns {{ value: any, cut: { path: string, kept: number, total: number, unit: string }[] }} */
export function capText(value, { textLimit = RULES.textLimit, logLines = RULES.logLines, offset = 0 } = {}) {
  const cut = [];
  const walk = (node, path, key, depth) => {
    if (typeof node === 'string') {
      if (LOG_KEYS.test(key ?? '')) {
        const lines = node.split('\n');
        if (lines.length > logLines) {
          cut.push({ path, kept: logLines, total: lines.length, unit: 'lines' });
          return `[${lines.length - logLines} earlier lines left out]\n${lines.slice(-logLines).join('\n')}`;
        }
      }
      const start = Math.min(offset, node.length);
      if (node.length - start > textLimit) {
        cut.push({ path, kept: textLimit, total: node.length, unit: 'characters' });
        return `${node.slice(start, start + textLimit)}… [${node.length - start - textLimit} more characters left out]`;
      }
      return start ? node.slice(start) : node;
    }
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}[${i}]`, key, depth + 1));
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, path ? `${path}.${k}` : k, k, depth + 1)]));
  };
  return { value: walk(value, '', null, 0), cut };
}

// ---- size budget ----
const largestList = (obj) => Object.entries(obj).filter(([, v]) => Array.isArray(v)).sort((a, b) => sizeOf(b[1]) - sizeOf(a[1]))[0]?.[0] ?? null;

/** The list inside a result: the root array, or the biggest top-level array of an object. */
export const listKeyOf = (body) => (Array.isArray(body) ? '' : isObject(body) ? largestList(body) : null);

function shrinkStrings(node, limit) {
  if (typeof node === 'string') return node.length > limit ? `${node.slice(0, limit)}…` : node;
  if (Array.isArray(node)) return node.map((n) => shrinkStrings(n, limit));
  if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, shrinkStrings(v, limit)]));
  return node;
}

/**
 * Makes a value fit `maxBytes`: shortens the biggest list, then long strings. @returns {{ value: any, fitted: boolean, shown: number|null, of: number|null }}
 */
export function fitToBudget(value, maxBytes = RULES.maxBytes) {
  if (sizeOf(value) <= maxBytes) return { value, fitted: false, shown: null, of: null };
  const room = maxBytes - 700; // leave room for the note the caller adds
  const key = listKeyOf(value);
  let current = value;
  let shown = null;
  let of = null;
  if (key !== null) {
    const list = key === '' ? value : value[key];
    of = list.length;
    let lo = 0;
    let hi = list.length;
    const build = (n) => (key === '' ? list.slice(0, n) : { ...value, [key]: list.slice(0, n) });
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (sizeOf(build(mid)) <= room) lo = mid; else hi = mid - 1; }
    shown = lo;
    current = build(lo);
  }
  for (const limit of [1000, 300, 100]) {
    if (sizeOf(current) <= room) break;
    current = shrinkStrings(current, limit);
  }
  if (sizeOf(current) > room && isObject(current)) {
    const kept = {};
    const left = [];
    let used = 200;
    for (const [k, v] of Object.entries(current).sort((a, b) => sizeOf(a[1]) - sizeOf(b[1]))) {
      const size = sizeOf(v) + k.length + 4;
      if (used + size <= room) { kept[k] = v; used += size; } else left.push(k);
    }
    current = { ...kept, _left_out: { count: left.length, first: left.slice(0, 10) } };
  }
  return { value: current, fitted: true, shown, of };
}

/** One plain line about a result, for the preview note. */
export function describeBody(body) {
  const key = listKeyOf(body);
  const kb = `${Math.max(1, Math.round(sizeOf(body) / 1024))} KB`;
  if (key === '') return `${body.length} items, ${kb}`;
  if (key) return `${body[key].length} ${key}, ${kb}`;
  return `one result, ${kb}`;
}

// ---- paging through a kept result ----
/** One page of a kept result. @returns {{ value: any, page: number, pages: number, total: number|null }} */
export function pageOfBody(body, { page = 1, pageSize = RULES.pageSize } = {}) {
  const size = Math.min(Math.max(Number.isInteger(pageSize) ? pageSize : RULES.pageSize, 1), RULES.maxPageSize);
  const key = listKeyOf(body);
  if (key === null) return { value: body, page: 1, pages: 1, total: null };
  const list = key === '' ? body : body[key];
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(Math.max(Number.isInteger(page) ? page : 1, 1), pages);
  const slice = list.slice((at - 1) * size, at * size);
  const info = { page: at, pages, page_size: size, total: list.length };
  if (key === '') return { value: { items: slice, page_info: info }, ...info };
  const rest = at === 1 ? body : {};
  return { value: { ...rest, [key]: slice, page_info: info }, ...info };
}
