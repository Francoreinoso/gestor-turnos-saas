import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { publicService } from './public';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => ({ url: fetchMock.mock.calls[i][0] as string, init: fetchMock.mock.calls[i][1] as RequestInit });

test('getAccount → GET /public/accounts/:id', async () => {
  await publicService.getAccount('acc-1');
  expect(call().url).toBe('/api/public/accounts/acc-1');
});

test('getSlots → GET /availability/:id con service_id, rango y employee_id solo si se eligió', async () => {
  await publicService.getSlots('acc-1', { serviceId: 'svc-1', dateFrom: '2030-01-07T03:00:00.000Z', dateTo: '2030-01-21T03:00:00.000Z' });
  await publicService.getSlots('acc-1', { serviceId: 'svc-1', employeeId: 'usr-1', dateFrom: 'a', dateTo: 'b' });
  const first = new URL(call(0).url, 'http://x');
  expect(first.pathname).toBe('/api/availability/acc-1');
  expect(first.searchParams.get('service_id')).toBe('svc-1');
  expect(first.searchParams.get('date_from')).toBe('2030-01-07T03:00:00.000Z');
  expect(first.searchParams.has('employee_id')).toBe(false);
  expect(new URL(call(1).url, 'http://x').searchParams.get('employee_id')).toBe('usr-1');
});

test('book → POST /public/bookings con el payload', async () => {
  const payload = { account_id: 'a', service_id: 's', scheduled_at: 't', client: { name: 'Ana' } };
  await publicService.book(payload);
  expect(call().url).toBe('/api/public/bookings');
  expect(call().init.method).toBe('POST');
  expect(JSON.parse(call().init.body as string)).toEqual(payload);
});

test('RF-30: getAppointment, cancel y reschedule llevan el token solo en la query (escapado)', async () => {
  await publicService.getAppointment('apt-1', 'tok&en');
  await publicService.cancel('apt-1', 'tok&en');
  await publicService.reschedule('apt-1', 'tok&en', { scheduled_at: 'x', employee_id: 'usr-1' });

  expect(call(0).url).toBe('/api/public/appointments/apt-1?token=tok%26en');
  expect(call(1).url).toBe('/api/public/appointments/apt-1/cancel?token=tok%26en');
  expect(call(1).init.method).toBe('PATCH');
  expect(call(2).url).toBe('/api/public/appointments/apt-1/reschedule?token=tok%26en');
  expect(JSON.parse(call(2).init.body as string)).toEqual({ scheduled_at: 'x', employee_id: 'usr-1' });
  for (let i = 0; i < 3; i++) expect(String(call(i).init.body ?? '')).not.toContain('tok');
});

// spec 009 RF-23, RF-25
test('activateAccount: POST público sin JWT y un 401/410 no cierra la sesión del panel', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'token_expired' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('token', 'jwt-del-panel');
  const logout = vi.fn();
  window.addEventListener('auth:logout', logout);
  try {
    await expect(publicService.activateAccount('tok', 'clave12345')).rejects.toMatchObject({ status: 410, message: 'token_expired' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/public/staff-invitations/activate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'tok', password: 'clave12345' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(logout).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('auth:logout', logout);
    vi.unstubAllGlobals();
  }
});
