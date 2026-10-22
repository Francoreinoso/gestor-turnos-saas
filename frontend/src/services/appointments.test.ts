import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { appointmentsService } from './appointments';
import { clientsService } from './clients';
import { paymentsService } from './payments';

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('token', 'jwt');
  fetchMock = vi.fn(async () => respond({}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: init.body && JSON.parse(init.body as string) };
};

test('create y block hacen POST con el cuerpo tal cual', async () => {
  await appointmentsService.create({ service_id: 's1', scheduled_at: 'x', client_id: 'c1' });
  expect(lastCall()).toEqual({ url: '/api/appointments', method: 'POST', body: { service_id: 's1', scheduled_at: 'x', client_id: 'c1' } });
  await appointmentsService.block({ scheduled_at: 'a', scheduled_until: 'b', assigned_user_id: null });
  expect(lastCall()).toEqual({ url: '/api/appointments/block', method: 'POST', body: { scheduled_at: 'a', scheduled_until: 'b', assigned_user_id: null } });
});

test('cancel, cancelBlock y correct son PATCH sobre su ruta', async () => {
  await appointmentsService.cancel('a1');
  expect(lastCall()).toMatchObject({ url: '/api/appointments/a1/cancel', method: 'PATCH' });
  await appointmentsService.cancelBlock('a1');
  expect(lastCall()).toMatchObject({ url: '/api/appointments/a1/cancel-block', method: 'PATCH' });
  await appointmentsService.correct('a1');
  expect(lastCall()).toMatchObject({ url: '/api/appointments/a1/correct', method: 'PATCH' });
});

test('edit: PATCH /appointments/:id con los campos editados', async () => {
  await appointmentsService.edit('a1', { notes: null, service_id: 's2' });
  expect(lastCall()).toEqual({ url: '/api/appointments/a1', method: 'PATCH', body: { notes: null, service_id: 's2' } });
});

test('list arma la query con los parámetros', async () => {
  await appointmentsService.list({ date_from: 'a', date_to: 'b', employee_id: 'u1' });
  expect(lastCall().url).toBe('/api/appointments?date_from=a&date_to=b&employee_id=u1');
});

test('clients.list: GET /clients', async () => {
  await clientsService.list();
  expect(lastCall()).toMatchObject({ url: '/api/clients', method: 'GET' });
});

test('payments.summary y list arman date_from/date_to y employee_id solo si hay', async () => {
  await paymentsService.summary({ from: '2026-05-01T03:00:00.000Z', to: '2026-06-01T02:59:59.999Z' });
  const u = new URL(lastCall().url, 'http://x');
  expect(u.pathname).toBe('/api/payments/summary');
  expect(u.searchParams.get('date_from')).toBe('2026-05-01T03:00:00.000Z');
  expect(u.searchParams.get('date_to')).toBe('2026-06-01T02:59:59.999Z');
  expect(u.searchParams.has('employee_id')).toBe(false);
  expect(u.searchParams.has('period')).toBe(false);

  await paymentsService.list({ from: 'a', to: 'b', employeeId: 'u1' });
  const l = new URL(lastCall().url, 'http://x');
  expect(l.pathname).toBe('/api/payments');
  expect(l.searchParams.get('employee_id')).toBe('u1');
});
