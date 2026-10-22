import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { staffService } from './staff';

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('token', 'jwt');
  fetchMock = vi.fn(async () => respond({ staff: [], user: { id: 'u1' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: init.body, headers: init.headers as Record<string, string> };
};

test('list: GET /staff con filtro opcional y desenvuelve { staff }', async () => {
  fetchMock.mockResolvedValueOnce(respond({ staff: [{ id: 'a' }] }));
  expect(await staffService.list()).toEqual([{ id: 'a' }]);
  expect(lastCall().url).toBe('/api/staff');
  await staffService.list('pendiente');
  expect(lastCall().url).toBe('/api/staff?status=pendiente');
});

test('invite: POST /staff y devuelve el enlace', async () => {
  fetchMock.mockResolvedValueOnce(respond({ user: { id: 'a' }, invitation_link: 'http://x/activar?token=t', action: 'create' }));
  const res = await staffService.invite({ name: 'Ana', email: 'ana@test.com', commission_rate: 0.25 });
  expect(res.invitation_link).toBe('http://x/activar?token=t');
  const c = lastCall();
  expect(c.method).toBe('POST');
  expect(c.url).toBe('/api/staff');
  expect(JSON.parse(c.body as string)).toEqual({ name: 'Ana', email: 'ana@test.com', commission_rate: 0.25 });
});

test('edit: PATCH /staff/:id y conserva commission_rate null', async () => {
  await staffService.edit('u1', { name: 'N', commission_rate: null });
  const c = lastCall();
  expect(c.method).toBe('PATCH');
  expect(c.url).toBe('/api/staff/u1');
  expect(JSON.parse(c.body as string)).toEqual({ name: 'N', commission_rate: null });
});

test('resendInvitation y deactivate: PATCH sin cuerpo', async () => {
  await staffService.resendInvitation('u1');
  expect(lastCall()).toMatchObject({ method: 'PATCH', url: '/api/staff/u1/resend-invitation', body: undefined });
  await staffService.deactivate('u1');
  expect(lastCall()).toMatchObject({ method: 'PATCH', url: '/api/staff/u1/deactivate', body: undefined });
});

test('getAvailability: GET; replaceAvailability: PUT con todo el horario y el JWT', async () => {
  await staffService.getAvailability('u1');
  expect(lastCall()).toMatchObject({ method: 'GET', url: '/api/staff/u1/availability' });
  const windows = [{ day_of_week: 1, start_time: '09:00', end_time: '12:00' }];
  await staffService.replaceAvailability('u1', windows);
  const c = lastCall();
  expect(c.method).toBe('PUT');
  expect(c.url).toBe('/api/staff/u1/availability');
  expect(JSON.parse(c.body as string)).toEqual(windows);
  expect(c.headers.Authorization).toBe('Bearer jwt');
});

test('editMe: PATCH /me', async () => {
  await staffService.editMe({ name: 'Yo', password: 'clave12345' });
  expect(lastCall()).toMatchObject({ method: 'PATCH', url: '/api/me' });
});
