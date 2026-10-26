// Redirect Location values may contain short-lived bearer credentials unrelated to token syntax.
// Never send them to an AI tool, including under detail:full or fields selection.
// A clean HTTPS codeload path is usable; all other redirects are deliberately withheld.
const ARCHIVE_PATH = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/legacy\.(?:tar\.gz|zip)\/[A-Za-z0-9_.\/-]+$/;
const SAFE_OWNER = /^[A-Za-z0-9-]{1,39}$/;
const SAFE_REPO = /^[A-Za-z0-9_.-]{1,100}$/;

/** Human navigation only: never a provider-supplied redirect or any signed query. */
export function githubDownloadPage(owner, repo, suffix = '') {
  if (!SAFE_OWNER.test(String(owner)) || !SAFE_REPO.test(String(repo)))
    return 'https://github.com';
  return 'https://github.com/' + owner + '/' + repo + (suffix ? '/' + suffix : '');
}

/** Parse the redirect inside the trusted server, but do not serialize any unsafe value. */
export function safeGithubDownloadRedirect(location, githubWebUrl) {
  if (typeof location !== 'string' || location.length === 0)
    throw new TypeError('GitHub did not return a download address.');
  let url;
  try { url = new URL(location); }
  catch { throw new TypeError('GitHub did not return a valid download address.'); }
  if (url.protocol === 'https:' &&
      url.hostname === 'codeload.github.com' &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      ARCHIVE_PATH.test(url.pathname) && !url.pathname.includes('..')) {
    return { url: url.href, sensitive_redirect_omitted: false };
  }
  return {
    url: null,
    sensitive_redirect_omitted: true,
    github_web_url: githubWebUrl,
    note: 'GitHub returned a temporary or unverified download address that may grant access to private data. It was withheld from the AI result. Sign in to GitHub and open the linked page to retrieve the archive.'
  };
}
