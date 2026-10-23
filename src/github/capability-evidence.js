// CAP-1: operation-specific official references; a credential statement here
// describes provider documentation, NOT an enrolled grant or working route.
// Unknowns are intentionally absent. Never infer family-level privileges.
export const REST_CREDENTIAL_EVIDENCE = Object.freeze({
  // Explicitly reviewed GitHub.com REST operations. Do NOT infer Package
  // registry upload/pull support or treat an App-token-compatible REST list
  // route as requiring God Mode's separate classic P token.
  'GET /orgs/{org}/packages': Object.freeze({
    officialUrl:'https://docs.github.com/en/rest/packages/packages?apiVersion=2026-03-10#list-packages-for-an-organization',
    reviewed:'2026-10-21',
    decisions:Object.freeze({
      app_installation:{disposition:'supported',permissions:[],scopes:null,
        note:'Metadata REST read can use an installation token; resource/installation access still applies'},
      app_user:{disposition:'supported',permissions:[],scopes:null,
        note:'Metadata REST read can use a GitHub App user token within user and App access'},
      fine_grained_pat:{disposition:'unsupported',permissions:null,scopes:null,
        note:'Not among fine-grained token types documented for this endpoint'},
      oauth_app:{disposition:'supported',permissions:null,scopes:['read:packages'],
        note:'OAuth App user grant must have read:packages; access and SSO still apply'},
      classic_pat:{disposition:'supported',permissions:null,scopes:['read:packages'],
        note:'Classic PAT must have read:packages; package and SSO rights still apply'}
    })
  }),
  'GET /notifications': Object.freeze({
    officialUrl:'https://docs.github.com/en/rest/activity/notifications?apiVersion=2026-03-10#list-notifications-for-the-authenticated-user',
    reviewed:'2026-10-21',
    decisions:Object.freeze({
      classic_pat:{disposition:'supported',permissions:null,scopes:['notifications','repo'],
        note:'Notifications endpoints support only classic personal access tokens; one of these scopes is required'},
      app_installation:{disposition:'unsupported',permissions:null,scopes:null,
        note:'Notifications API does not support GitHub App installation tokens'},
      app_user:{disposition:'unsupported',permissions:null,scopes:null,
        note:'Notifications API does not support GitHub App user tokens'},
      fine_grained_pat:{disposition:'unsupported',permissions:null,scopes:null,
        note:'Notifications API does not support fine-grained personal tokens'},
      oauth_app:{disposition:'unsupported',permissions:null,scopes:null,
        note:'Notifications API requires classic personal access token'}
    })
  }),
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
