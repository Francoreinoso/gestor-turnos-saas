import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, apiPublic, ApiError } from './api';

const respond = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let logout: () => void & ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('token', 'jwt-del-panel');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  logout = vi.fn() as typeof logout;
  window.addEventListener('auth:logout', logout);
});

afterEach(() => {
  window.removeEventListener('auth:logout', logout);
  vi.unstubAllGlobals();
});

const sentHeaders = () => (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

test('RF-31: apiPublic no manda Authorization aunque haya un token en localStorage', async () => {
  fetchMock.mockResolvedValue(respond(200, { ok: true }));
  await apiPublic.get('/public/accounts/x');
  expect(sentHeaders().Authorization).toBeUndefined();
});

test('RF-31: un 401 en apiPublic NO dispara auth:logout y lanza ApiError con el código', async () => {
  fetchMock.mockResolvedValue(respond(401, { error: 'token_expired' }));
  await expect(apiPublic.get('/public/appointments/x?token=t')).rejects.toMatchObject({ status: 401, message: 'token_expired' });
  expect(logout).not.toHaveBeenCalled();
});

test('RF-31: api (panel) sigue mandando el JWT', async () => {
  fetchMock.mockResolvedValue(respond(200, {}));
  await api.get('/appointments');
  expect(sentHeaders().Authorization).toBe('Bearer jwt-del-panel');
});

test('RF-31: api (panel) sigue emitiendo auth:logout ante un 401', async () => {
  fetchMock.mockResolvedValue(respond(401, { error: 'unauthorized' }));
  await expect(api.get('/appointments')).rejects.toBeInstanceOf(ApiError);
  expect(logout).toHaveBeenCalledTimes(1);
});

test('apiPublic usa el prefijo /api, serializa el body y soporta PATCH sin body', async () => {
  fetchMock.mockImplementation(async () => respond(200, {}));
  await apiPublic.post('/public/bookings', { a: 1 });
  await apiPublic.patch('/public/appointments/x/cancel?token=t');
  expect(fetchMock.mock.calls[0][0]).toBe('/api/public/bookings');
  expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe('{"a":1}');
  expect(fetchMock.mock.calls[1][0]).toBe('/api/public/appointments/x/cancel?token=t');
  expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBeUndefined();
});

// spec 009 T09
test('api.put manda PUT con el cuerpo serializado y el JWT del panel', async () => {
  fetchMock.mockResolvedValue(respond(200, []));
  await api.put('/staff/u1/availability', [{ day_of_week: 1 }]);
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('PUT');
  expect(init.body).toBe('[{"day_of_week":1}]');
  expect(sentHeaders().Authorization).toBe('Bearer jwt-del-panel');
});

test('RF-22: un fallo de red se convierte en ApiError network_error', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(apiPublic.get('/public/accounts/x')).rejects.toMatchObject({ status: 0, message: 'network_error' });
});
