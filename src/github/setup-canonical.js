// Canonicalize public setup GETs before issuing host-bound CSRF cookies.
// The trusted destination comes exclusively from configured PUBLIC_BASE_URL;
// never interpret an incoming Host as an authorized login origin.
export function canonicalSetupUrl(req, configuredOrigin) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || !host ||
      host.toLowerCase() === new URL(configuredOrigin).host.toLowerCase()) return null;
  const query = new URLSearchParams();
  const installationId = req.query?.installation_id;
  if (typeof installationId === 'string' && /^[1-9][0-9]{0,19}$/.test(installationId))
    query.set('installation_id', installationId);
  for (const key of ['show', 'secret']) {
    const value = req.query?.[key];
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(value))
      query.set(key, value);
  }
  const suffix = query.toString();
  return `${configuredOrigin}/api/github/setup${suffix ? `?${suffix}` : ''}`;
}
