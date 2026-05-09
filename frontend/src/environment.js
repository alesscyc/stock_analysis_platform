/**
 * Returns true if the app is being served from GitHub Pages.
 * Checks the hostname (alesscyc.github.io) and the path prefix.
 */
export function isGitHubPages() {
  return (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'alesscyc.github.io' ||
      window.location.pathname.startsWith('/stock_analysis_platform'))
  );
}

/**
 * Returns the base URL for API calls.
 * On GitHub Pages, API calls won't work, so we return null.
 * Locally, uses relative paths (Vite proxy handles it).
 */
export function getApiBase() {
  if (isGitHubPages()) return null;
  return '';
}
