// CAP-1: operation-specific official references; a credential statement here
// describes provider documentation, NOT an enrolled grant or working route.
// Unknowns are intentionally absent. Never infer family-level privileges.
export const REST_CREDENTIAL_EVIDENCE = Object.freeze({
  'GET /user': Object.freeze({
    officialUrl: 'https://docs.github.com/en/rest/users/users?apiVersion=2026-03-10#get-the-authenticated-user',
    reviewed: '2026-10-21',
    decisions: Object.freeze({
      app_user: {disposition: 'supported', permissions: [], scopes: null,
        note: 'Verified user identity; no fine-grained permissions required'},
      app_installation: {disposition: 'unsupported', permissions: null, scopes: null,
        note: 'Installation tokens are excluded from the documented compatible fine-grained types'},
      fine_grained_pat: {disposition: 'supported', permissions: [], scopes: null,
        note: 'No fine-grained permissions; private versus public response fields still depend on token scope/type'},
      oauth_app: {disposition: 'supported', permissions: null, scopes: ['read:user', 'user'],
        note: 'Either scope returns private response fields; otherwise public user fields only'},
      classic_pat: {disposition: 'supported', permissions: null, scopes: ['read:user', 'user'],
        note: 'Either scope returns private response fields; otherwise public user fields only'}
    })
  }),
  'PATCH /user': Object.freeze({
    officialUrl: 'https://docs.github.com/en/rest/users/users?apiVersion=2026-03-10#update-the-authenticated-user',
    reviewed: '2026-10-21',
    decisions: Object.freeze({
      app_user: {disposition: 'supported', permissions: ['user:profile:write'], scopes: null,
        note: 'User Profile write permission is required'},
      app_installation: {disposition: 'unsupported', permissions: null, scopes: null,
        note: 'Installation tokens are excluded from the compatible fine-grained types'},
      fine_grained_pat: {disposition: 'supported', permissions: ['user:profile:write'], scopes: null,
        note: 'User Profile write permission is required'}
    })
  }),
  'GET /app': Object.freeze({
    officialUrl: 'https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#get-the-authenticated-app',
    reviewed: '2026-10-21',
    decisions: Object.freeze({
      app_jwt: {disposition: 'supported', permissions: null, scopes: null,
        note: 'Must use a GitHub App JWT, not an installation or App user token'},
      app_user: {disposition: 'unsupported', permissions: null, scopes: null,
        note: 'The documented endpoint requires App JWT'},
      app_installation: {disposition: 'unsupported', permissions: null, scopes: null,
        note: 'The documented endpoint requires App JWT'},
      fine_grained_pat: {disposition: 'unsupported', permissions: null, scopes: null,
        note: 'The documented endpoint requires App JWT'}
    })
  }),
  'GET /repos/{owner}/{repo}': Object.freeze({
    officialUrl: 'https://docs.github.com/en/rest/repos/repos?apiVersion=2026-03-10#get-a-repository',
    reviewed: '2026-10-21',
    decisions: Object.freeze({
      app_user: {disposition: 'supported', permissions: ['repository:metadata:read'], scopes: null,
        note: 'Repository Metadata read for nonpublic resources; public repos also allow anonymous read'},
      app_installation: {disposition: 'supported', permissions: ['repository:metadata:read'], scopes: null,
        note: 'Must be in the installation resource scope; public repositories allow anonymous read'},
      fine_grained_pat: {disposition: 'supported', permissions: ['repository:metadata:read'], scopes: null,
        note: 'Repository Metadata read for nonpublic resources; public repos also allow anonymous read'}
    })
  })
});
export function reviewedRestEvidence(route) {
  return Object.hasOwn(REST_CREDENTIAL_EVIDENCE, route) ? REST_CREDENTIAL_EVIDENCE[route] : null;
}
