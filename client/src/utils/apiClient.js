// Fetch wrapper that attaches the existing JWT without logging token metadata.
export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? 'https://ayursutra-53m7.onrender.com' : '')).replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function authFetch(url, options = {}) {
  const hadToken = Boolean(localStorage.getItem('token'));
  const headers = { ...authHeaders(), ...(options.headers || {}) };

  const res = await fetch(apiUrl(url), { ...options, headers });
  if (res.status === 401 && hadToken && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ayursutra:unauthorized'));
  }
  return res;
}

export function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { 'x-auth-token': token } : {};
}

export default authFetch;
