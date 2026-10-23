// Small helpers shared by the tools that change things on GitHub (D-1, D-2): the client for an account, a 404 as "not there", a
// plain refusal that the write layer reports as `rejected`, and the owner/repo slug.
import { githubFor } from '../github/client.js';

export const octo = (ctx, owner, cred = 'I') => githubFor(ctx, { owner, cred });
export const slug = (owner, repo) => `${owner}/${repo}`;
export const ownerOf = (args, ctx) => String(args.owner ?? ctx.connection.default_account);
/** An error GitHub-style (status 4xx), so the write layer treats it as "definitely not done". */
// `safeMessage` marks wording written by this service, so a failed preflight read may show it to the person instead of a generic line.
export const refusal = (message, status = 422) => Object.assign(new Error(message), { status, safeMessage: true });
/** Runs a read; a 404 answers `null` instead of throwing. */
export const missing = async (fn) => { try { return await fn(); } catch (error) { if (error?.status === 404) return null; throw error; } };
