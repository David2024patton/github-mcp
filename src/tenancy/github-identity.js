// PUB-2: dormant, PRIVATE, fail-closed GitHub provider identity verification.
// No endpoint consumes this module yet. Real OAuth consent, GitHub installation
// delegation and a tenant-bound MCP client are required before the private pilot
// may be enabled for any human outside the development fixture.
const USER_ENDPOINT = 'https://api.github.com/user';
const SUBJECT = /^[1-9][0-9]{0,18}$/;

/** GitHub's numeric immutable /user id, NOT login/email, is the principal.
 * The OAuth bearer exists only in the outbound provider request. It is never
 * stored in pilot state, returned to the client or included in thrown errors. */
export async function verifyGithubBearerIdentity(bearer, { fetchImpl = fetch,
  timeoutMs = 10000 } = {}) {
  if (typeof bearer !== 'string' || bearer.length < 8 || bearer.length > 4096 ||
      /[^\x21-\x7e]/.test(bearer)) {
    throw new TypeError('An authenticated GitHub OAuth bearer is required.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw new TypeError('Invalid GitHub identity lookup timeout.');
  let response, data;
  try {
    response = await fetchImpl(USER_ENDPOINT, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + bearer,
        'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response?.ok || response.status !== 200) throw new Error('upstream_refused');
    data = await response.json();
  } catch {
    throw new Error('GitHub identity verification is unavailable or refused.');
  }
  const id = data?.id;
  const subject = typeof id === 'number' && Number.isSafeInteger(id) ? String(id)
    : typeof id === 'string' ? id : '';
  if (!SUBJECT.test(subject) || data.type !== 'User' ||
      typeof data.login !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(data.login)) {
    throw new Error('GitHub did not return a verified user identity.');
  }
  return Object.freeze({ subject, login: data.login, provider: 'github' });
}

/** Future adapters must supply trustedTenantId from the SERVER-OWNED OAuth
 * registration record, never from URL/form fields. Existing owner connection
 * is intentionally outside this API; no fallback to its global db allowed.
 * GITHUB_PRIVATE_TENANT_PILOT defaults CLOSED, even on a production release. */
export async function resolvePrivatePilotIdentity({
  oauthBearer, trustedTenantId, directory, env = process.env, fetchImpl = fetch
}) {
  if (env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled')
    throw new Error('Private tenant pilot is disabled.');
  if (typeof directory?.resolveAllowlistedPilotSubject !== 'function' ||
      typeof directory?.authorized !== 'function') {
    throw new TypeError('Private pilot requires a verified tenant directory.');
  }
  // Confirm GitHub bearer BEFORE doing any account/tenant lookup. No caller
  // assertion about subject, email, login, or app installation is trusted.
  const principal = await verifyGithubBearerIdentity(oauthBearer, { fetchImpl });
  const allowed = await directory.resolveAllowlistedPilotSubject(trustedTenantId, principal.subject);
  if (!allowed) throw new Error('GitHub identity has no approved private tenant pilot access.');
  const live = await directory.authorized(allowed.tenantId, allowed.identityId);
  if (!live || live.namespace !== allowed.namespace ||
      live.membershipRevision !== allowed.membershipRevision) {
    throw new Error('GitHub identity membership is no longer active.');
  }
  return Object.freeze({ principal, tenant: allowed });
}

/** GitHub App user-token installation proof, including users with over 100
 * installed Apps. An incomplete or conflicting provider inventory is a
 * refusal even when the target appears on an earlier page. */
export async function verifyGithubUserInstallation(bearer, {
  installationId, appId, accountId, fetchImpl = fetch
} = {}) {
  if (![installationId, appId, accountId].every(x => Number.isSafeInteger(x) && x > 0))
    return false;
  if (typeof bearer !== 'string' || bearer.length < 8 || bearer.length > 4096)
    return false;
  const pageSize=100, maxPages=20;
  let total=null, inspected=0, matching=false;
  const seen=new Set();
  try {
    for(let pageNumber=1;pageNumber<=maxPages;pageNumber++){
      // Never follow a provider-supplied Link URL. Restrict every page to
      // the same exact trusted authenticated GitHub endpoint and U bearer.
      const url='https://api.github.com/user/installations?per_page=100'+
        (pageNumber===1?'':'&page='+pageNumber);
      const response=await fetchImpl(url,{
        method:'GET',
        headers:{accept:'application/vnd.github+json',
          authorization:'Bearer '+bearer,'x-github-api-version':'2022-11-28'},
        signal:AbortSignal.timeout(10000)
      });
      if(!response?.ok || response.status!==200) return false;
      const result=await response.json();
      const count=result?.total_count;
      if(!Number.isSafeInteger(count) || count<0 || count>pageSize*maxPages ||
          !Array.isArray(result?.installations) ||
          (total!==null && count!==total)) return false;
      if(total===null) total=count;
      const required=Math.min(pageSize,total-inspected);
      if(result.installations.length!==required) return false;
      for(const entry of result.installations){
        if(!Number.isSafeInteger(entry?.id) || entry.id<=0 || seen.has(entry.id))
          return false;
        seen.add(entry.id);
        if(entry.id===installationId && entry.app_id===appId &&
            entry.account?.id===accountId && !entry.suspended_at) matching=true;
      }
      inspected+=required;
      if(inspected===total) return matching;
    }
    return false;
  } catch { return false; }
}

/** PUB-6: the active installations of ONE configured GitHub App that this user's own token can see. Same strict,
 * exact-endpoint paging as the proof above; an incomplete or inconsistent inventory returns null (refusal), never a
 * partial list. Only plain facts are returned; the bearer never leaves this function. */
export async function listUserAppInstallations(bearer, { appId, fetchImpl = fetch } = {}) {
  if (!Number.isSafeInteger(appId) || appId <= 0) return null;
  if (typeof bearer !== 'string' || bearer.length < 8 || bearer.length > 4096) return null;
  const pageSize = 100, maxPages = 20;
  let total = null, inspected = 0;
  const seen = new Set(), found = [];
  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const url = 'https://api.github.com/user/installations?per_page=100' + (pageNumber === 1 ? '' : '&page=' + pageNumber);
      const response = await fetchImpl(url, { method: 'GET',
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + bearer, 'x-github-api-version': '2022-11-28' },
        signal: AbortSignal.timeout(10000) });
      if (!response?.ok || response.status !== 200) return null;
      const result = await response.json();
      const count = result?.total_count;
      if (!Number.isSafeInteger(count) || count < 0 || count > pageSize * maxPages ||
          !Array.isArray(result?.installations) || (total !== null && count !== total)) return null;
      if (total === null) total = count;
      const required = Math.min(pageSize, total - inspected);
      if (result.installations.length !== required) return null;
      for (const entry of result.installations) {
        if (!Number.isSafeInteger(entry?.id) || entry.id <= 0 || seen.has(entry.id)) return null;
        seen.add(entry.id);
        if (entry.app_id !== appId || entry.suspended_at) continue;
        const login = entry.account?.login, type = entry.account?.type;
        if (!Number.isSafeInteger(entry.account?.id) || entry.account.id <= 0 ||
            typeof login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login) ||
            !['User', 'Organization'].includes(type) ||
            !['all', 'selected'].includes(entry.repository_selection)) continue;
        found.push(Object.freeze({ installationId: entry.id, accountId: entry.account.id, login, type,
          repositorySelection: entry.repository_selection, permissions: entry.permissions ?? {} }));
      }
      inspected += required;
      if (inspected === total) return found;
    }
    return null;
  } catch { return null; }
}

/** PUB-6: may this signed-in person act for the installation's account? Installation tokens act with the App's own rights,
 * so a person may only connect their OWN personal account or an organization where GitHub says they are an active ADMIN.
 * Anything unclear (missing permission, error, mismatch) is a refusal. */
export async function verifyAccountAuthority(bearer, { installation, subject, fetchImpl = fetch } = {}) {
  if (!installation || typeof bearer !== 'string' || bearer.length < 8 || bearer.length > 4096) return false;
  if (installation.type === 'User') return String(installation.accountId) === String(subject);
  if (installation.type !== 'Organization' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(String(installation.login))) return false;
  try {
    const response = await fetchImpl('https://api.github.com/user/memberships/orgs/' + installation.login, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + bearer, 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(10000) });
    if (!response?.ok || response.status !== 200) return false;
    const data = await response.json();
    return data?.state === 'active' && data?.role === 'admin' && data?.organization?.id === installation.accountId;
  } catch { return false; }
}
