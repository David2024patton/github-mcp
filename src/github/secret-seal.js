// Sealing and writing a GitHub secret (G-3). GitHub only accepts a secret encrypted with the public key of the place it goes
// (libsodium `crypto_box_seal`), so a value is sealed here and only the sealed text is sent. The plain value is used inside one
// function call and is never logged, stored or returned.
import { randomBytes } from 'node:crypto';
import sodium from 'libsodium-wrappers';

export const SECRET_KINDS = Object.freeze(['actions', 'dependabot', 'codespaces', 'agents']);

/** The three API paths for a secret's place. `scope` is `{ kind, level: 'repo'|'environment'|'org', owner, repo?, environment?, name? }`. */
export function secretRoutes(scope) {
  const { kind = 'actions', level } = scope;
  if (!SECRET_KINDS.includes(kind)) throw new TypeError(`Unknown secret kind "${kind}".`);
  if (level === 'environment') {
    if (kind !== 'actions') throw new TypeError('Only Actions secrets exist per environment.');
    const base = '/repos/{owner}/{repo}/environments/{environment_name}/secrets';
    return { key: `GET ${base}/public-key`, one: `${base}/{secret_name}`, params: { owner: scope.owner, repo: scope.repo, environment_name: scope.environment } };
  }
  if (level === 'org') {
    const base = `/orgs/{org}/${kind}/secrets`;
    return { key: `GET ${base}/public-key`, one: `${base}/{secret_name}`, params: { org: scope.owner }, repositories: `${base}/{secret_name}/repositories` };
  }
  const base = `/repos/{owner}/{repo}/${kind}/secrets`;
  return { key: `GET ${base}/public-key`, one: `${base}/{secret_name}`, params: { owner: scope.owner, repo: scope.repo } };
}

/** Seals `value` for a place's public key (base64), returning base64 text GitHub accepts as `encrypted_value`. */
export async function sealSecret(publicKeyBase64, value) {
  await sodium.ready;
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  return sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(String(value)), key), sodium.base64_variants.ORIGINAL);
}

/** A random value made on the server (hex), for secrets only GitHub Actions needs to know. */
export const generateSecretValue = (bytes = 32) => randomBytes(bytes).toString('hex');

/**
 * Fetches the place's public key, seals the value and writes it. Organization secrets also need `visibility`.
 * @param {{ request: Function }} octokit
 */
export async function putSecret(octokit, scope, value, { visibility, selectedRepositoryIds } = {}) {
  const routes = secretRoutes(scope);
  const key = (await octokit.request(routes.key, routes.params)).data;
  const body = { encrypted_value: await sealSecret(key.key, value), key_id: key.key_id };
  if (scope.level === 'org') {
    body.visibility = visibility ?? 'private';
    if (body.visibility === 'selected') body.selected_repository_ids = selectedRepositoryIds ?? [];
  }
  return octokit.request(`PUT ${routes.one}`, { ...routes.params, secret_name: scope.name, ...body });
}
