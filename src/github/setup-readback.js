// "Read back" for the setup page (A5): after each step the page asks GitHub what is true now and shows it, so the owner sees
// exactly what is set up and what is missing instead of trusting that a click worked. Every step is independent and
// tolerant: a failure becomes one plain sentence, never a token, a URL with a credential or a stack.
import { bareOctokit } from './client.js';
import { MANIFEST_PERMISSIONS } from './app-manifest.js';

const LEVEL = { read: 1, write: 2, admin: 3 };

/** Permissions the manifest asks for that the installation does not have (or has at a lower level), as "name (read→write)". */
export function missingPermissions(granted = {}, wanted = MANIFEST_PERMISSIONS) {
  return Object.entries(wanted)
    .filter(([name, level]) => (LEVEL[granted[name]] ?? 0) < LEVEL[level])
    .map(([name, level]) => `${name} (${granted[name] ?? 'none'}→${level})`);
}

const plain = (error) => (error?.status ? `GitHub answered ${error.status}` : 'GitHub could not be reached');

/**
 * @returns {Promise<object>} what is true for one account right now. Updates the stored installation when GitHub shows one
 *   the server had not recorded (for example the owner installed the App but closed the page before returning).
 */
export async function readBack({ db, credentials, fetch }, login) {
  const row = await db.getAccount(login);
  if (!row) return { login, error: 'This account is not set up on the server.' };
  const result = {
    login: row.login, label: row.label, account_type: row.account_type, credential_kind: row.credential_kind,
    app: { created: row.app_id != null }, installation: { status: row.installation_status },
    user: { authorized: !!row.user_token_enc, login: row.user_login },
    fine_grained: { present: !!row.fine_grained_enc, last4: row.fine_grained_last4 },
    packages: { present: !!row.package_enc, actor: row.package_actor, scopes: row.package_scopes, expires_at: row.package_expires_at },
    classic: { present: !!row.classic_enc, last4: row.classic_last4, scopes: row.classic_scopes },
    production_enabled: row.production_enabled, is_default: row.is_default, is_scratch: row.is_scratch
  };
  if (row.app_id != null) {
    try {
      const octokit = bareOctokit({ token: await credentials.appJwt(row.app_id), fetch });
      const app = (await octokit.request('GET /app')).data;
      result.app = { created: true, slug: app.slug, name: app.name };
      let installation = null;
      if (row.installation_id != null) {
        installation = (await octokit.request('GET /app/installations/{installation_id}', { installation_id: row.installation_id }).catch((e) => {
          if (e?.status === 404) return null;
          throw e;
        }))?.data ?? null;
      }
      if (!installation) {
        const list = (await octokit.request('GET /app/installations', { per_page: 100 })).data;
        installation = list.find((i) => i.account?.login?.toLowerCase() === row.login.toLowerCase()) ?? null;
      }
      if (installation) {
        const status = installation.suspended_at ? 'suspended' : 'active';
        await db.setInstallation(row.login, { installationId: installation.id, repositorySelection: installation.repository_selection, permissions: installation.permissions ?? {}, status });
        result.installation = { status, repository_selection: installation.repository_selection, missing_permissions: missingPermissions(installation.permissions) };
      } else {
        await db.setInstallationStatus(row.login, 'none');
        result.installation = { status: 'none' };
      }
    } catch (error) {
      result.app.error = `Could not read the GitHub App back (${plain(error)}).`;
    }
  }
  if (row.user_token_enc) {
    try {
      const me = (await bareOctokit({ token: await credentials.token({ account: row.login, cred: 'U' }), fetch }).request('GET /user')).data;
      result.user = { authorized: true, login: me.login };
    } catch (error) {
      result.user = { authorized: false, error: error?.code === 'no_credentials' ? error.message : `Could not confirm your sign-in (${plain(error)}).` };
    }
  }
  return result;
}
