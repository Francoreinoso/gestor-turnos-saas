const BASE = '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface RequestOptions extends RequestInit {
  // false = llamada pública (spec 005 RF-31): sin JWT del panel y sin cerrar sesión ante un 401.
  auth?: boolean;
}

async function request<T>(path: string, { auth = true, ...options }: RequestOptions = {}): Promise<T> {
  const token = auth ? localStorage.getItem('token') : null;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  if (!res.ok) {
    if (auth && res.status === 401) window.dispatchEvent(new Event('auth:logout'));
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'error_desconocido');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get:    <T>(path: string)                  => request<T>(path),
  post:   <T>(path: string, body: unknown)   => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(path: string, body?: unknown)  => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string)                  => request<T>(path, { method: 'DELETE' }),
};

// Cliente de las pantallas públicas (reservar, gestionar turno): nunca adjunta el JWT ni desloguea.
export const apiPublic = {
  get:   <T>(path: string)                 => request<T>(path, { auth: false }),
  post:  <T>(path: string, body: unknown)  => request<T>(path, { auth: false, method: 'POST',  body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { auth: false, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};

export { ApiError };
