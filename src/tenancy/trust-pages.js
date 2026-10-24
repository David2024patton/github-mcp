// LAUNCH-1 C: the privacy notice, terms, security and support pages, served from the reviewed drafts in docs/legal/.
// Until the owner sets LEGAL_APPROVED=yes every page carries a visible "DRAFT - not yet approved" banner. The support email comes
// from PUBLIC_SUPPORT_EMAIL; while it is unset the pages say "coming soon". The pages are public and static: no sign-in, no personal data.
import { readFileSync } from 'node:fs';
import { escapeHtml as h } from '../core/http.js';

const FILES = Object.freeze({
  privacy: { title: 'Privacy notice', file: new URL('../../docs/legal/PRIVACY-DRAFT.md', import.meta.url) },
  terms: { title: 'Terms of use', file: new URL('../../docs/legal/TERMS-DRAFT.md', import.meta.url) },
  security: { title: 'Security', file: new URL('../../docs/legal/SECURITY-DRAFT.md', import.meta.url) },
  support: { title: 'Support', file: new URL('../../docs/legal/SUPPORT-DRAFT.md', import.meta.url) }
});
export const TRUST_PAGES = Object.freeze(Object.keys(FILES));
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const legalApproved = (env = process.env) => env.LEGAL_APPROVED === 'yes';
export const supportEmail = (env = process.env) => (EMAIL.test(String(env.PUBLIC_SUPPORT_EMAIL ?? '')) ? String(env.PUBLIC_SUPPORT_EMAIL) : null);

const cache = new Map();
const source = (name) => { if (!cache.has(name)) cache.set(name, readFileSync(FILES[name].file, 'utf8')); return cache.get(name); };

/** Inline text: escape first, then bold and the support-email placeholder, so nothing in a draft can become markup. */
function inline(text, email) {
  const safe = h(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const who = email ? `<a href="mailto:${h(email)}">${h(email)}</a>` : 'support email coming soon';
  return safe.replace(/\[support email\]/g, who);
}

/** A tiny, fixed markdown subset (headings, bullets, paragraphs, bold) - enough for the drafts, nothing that can run code. */
export function renderTrustBody(name, env = process.env) {
  const email = supportEmail(env), approved = legalApproved(env);
  const out = []; let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of source(name).split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith('# ')) { close(); continue; }
    if (/^Status:/.test(line)) { close(); if (!approved) out.push(`<p><small>${inline(line, email)}</small></p>`); continue; }
    if (line.startsWith('## ')) { close(); out.push(`<h2>${inline(line.slice(3), email)}</h2>`); continue; }
    if (line.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2), email)}</li>`); continue; }
    close(); out.push(`<p>${inline(line, email)}</p>`);
  }
  close();
  const banner = approved ? '' : '<p class="notice"><strong>DRAFT &mdash; not yet approved.</strong> This text is a working draft and may change before it is final.</p>';
  return { title: FILES[name].title, html: banner + out.join('') };
}
