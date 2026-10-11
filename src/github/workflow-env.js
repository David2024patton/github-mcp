// Which environments does a workflow file deploy to? (BATCH-G decision G2: starting a workflow that deploys to production is production.)
// A deliberately small reader for the `environment:` key of GitHub workflow files; anything it cannot read for certain is reported as
// `unknown`, and callers treat unknown as production.
const quoted = (v) => v.replace(/^['"]|['"]$/g, '').trim();

/** @returns {{ names: string[], unknown: boolean }} */
export function environmentsIn(yaml) {
  const names = new Set();
  let unknown = false;
  const lines = String(yaml ?? '').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)environment:\s*(.*?)\s*(?:#.*)?$/);
    if (!m) return;
    let value = m[2];
    if (!value) { // block form: `environment:` then an indented `name: x`
      for (let j = i + 1; j < lines.length; j += 1) {
        if (!lines[j].trim()) continue;
        if (lines[j].match(/^(\s*)/)[1].length <= m[1].length) break;
        const n = lines[j].match(/^\s*name:\s*(.+?)\s*(?:#.*)?$/);
        if (n) { value = n[1]; break; }
      }
    } else if (value.startsWith('{')) {
      const n = value.match(/name:\s*([^,}]+)/);
      value = n ? n[1] : '';
    }
    value = quoted(value);
    if (!value || value.includes('${{')) unknown = true; else names.add(value);
  });
  return { names: [...names], unknown };
}
