/** Host allowlists are provided by Excubitor; public distribution remains read-only. */
function hostName(value: string): string {
  if (!value || /[\s/@?#\\]/.test(value)) throw new Error('Invalid allowed host');
  const url = new URL(`http://${value}`);
  if (url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Invalid host');
  return url.hostname.toLowerCase();
}

export function distributionAccess(env: NodeJS.ProcessEnv): (host: string | undefined, origin: string | undefined) => boolean {
  const exact = new Set(['localhost', '127.0.0.1', '[::1]']);
  const suffixes: string[] = [];
  for (const raw of (env.LUDIARS_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw.includes('*')) throw new Error('Wildcard hosts are not supported');
    const suffix = raw.startsWith('.');
    const value = hostName(suffix ? raw.slice(1) : raw);
    if (suffix) suffixes.push(value); else exact.add(value);
  }
  let publicOrigin: string | undefined;
  if (env.MMP_PUBLIC_URL) {
    const url = new URL(env.MMP_PUBLIC_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('MMP_PUBLIC_URL must be an HTTPS origin');
    }
    publicOrigin = url.origin;
    exact.add(url.hostname.toLowerCase());
  }
  return (host, origin) => {
    if (!host) return false;
    try {
      const name = hostName(host);
      const allowed = exact.has(name) || suffixes.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
      return allowed && (origin === undefined || origin === publicOrigin || origin === `http://${host}`);
    } catch { return false; } // Untrusted HTTP authority is a rejected request, not a configuration error.
  };
}
