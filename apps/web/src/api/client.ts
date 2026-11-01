const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8888/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The CSRF token is read fresh from the `chorusify_csrf` cookie on every request rather than
 * cached in memory. The server can rotate the session (and therefore the CSRF pairing) not
 * just on explicit login/register/logout, but also silently whenever `sessionMiddleware`
 * has to reissue a guest session (e.g. a stale/unknown session cookie) — there's no reliable
 * single moment to "refresh a cached token" against every one of those paths. Reading the
 * cookie directly means the client is always in sync with whatever the server most recently
 * set, by construction, matching the double-submit-cookie pattern csrf-csrf implements.
 */
function readCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)(chorusify_csrf|__Host-chorusify\.csrf)=([^;]+)/);
  if (!match?.[2]) return null;
  const rawValue = decodeURIComponent(match[2]);
  return rawValue.split('|')[0] ?? null;
}

/** Ensures a CSRF cookie exists before the user does anything — the cookie is only ever
 * set in response to a request, so a brand-new visitor needs one round trip first. */
export async function primeCsrfToken(): Promise<void> {
  await fetch(`${API_URL}/csrf-token`, { credentials: 'include' });
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipCache?: boolean;
  signal?: AbortSignal;
}

const CACHE_TTL_MS = 5_000;
const getCache = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

export function invalidateApiCache(pathPrefix?: string) {
  if (!pathPrefix) {
    getCache.clear();
    return;
  }
  for (const key of getCache.keys()) {
    if (key.startsWith(pathPrefix)) getCache.delete(key);
  }
}

async function doFetch<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, { method, headers, credentials: 'include', body, signal });

  const contentType = res.headers.get('content-type') ?? '';
  const parsed = contentType.includes('application/json') ? await res.json() : undefined;

  if (!res.ok) {
    const message =
      (parsed as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (parsed as { details?: unknown } | undefined)?.details);
  }

  return parsed as T;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') {
    const csrfToken = readCsrfTokenFromCookie();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const url = `${API_URL}${path}`;
  const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  if (method !== 'GET' || options.skipCache) {
    if (method !== 'GET') invalidateApiCache();
    return doFetch<T>(url, method, headers, bodyStr, options.signal);
  }

  const cached = getCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise as Promise<T>;
  }

  const promise = doFetch<T>(url, method, headers, bodyStr);
  getCache.set(path, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  promise.catch(() => getCache.delete(path));

  return promise;
}
