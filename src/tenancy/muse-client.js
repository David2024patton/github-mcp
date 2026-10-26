// Muse Android's custom connector UI may not use dynamic client registration. This fixed
// *public* client identifier is NOT a credential: Muse obtains a per-person OAuth grant
// only after GitHub sign-in, consent, registered callback validation and S256 PKCE.
// Never bind this client to the owner administrator login or use a shared GitHub token.
export const MUSE_PUBLIC_CLIENT_ID = 'pcl_meta_muse_public_client_20261026_v1xyz';
export const MUSE_REDIRECT_URI = 'https://agent.meta.ai/api/hatch/oauth/callback';
