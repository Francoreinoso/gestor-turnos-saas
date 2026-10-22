// spec 007 T01 — caracterización: estado y código de cada error de forma/formato no cambian (RF-4, RF-5, RF-6).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { users, services } from '../../db/schema.js';

let api;
before(async () => { await setupDb(); api = await startApiServer(); });
after(async () => { await api.close(); await teardownDb(); });

const seedUser = (accountId, { role = 'owner', status = 'activo' } = {}) =>
  db.insert(users).values({
    account_id: accountId, name: role, email: `u-${crypto.randomUUID()}@test.com`, role, status, password_hash: 'x',
  }).returning().then(r => r[0]);

const NOW_PLUS_DAY = new Date(Date.now() + 86400000).toISOString();
const WIN = { day_of_week: 1, start_time: '09:00', end_time: '10:00' };

test('contrato de errores de forma y formato — RF-4, RF-5', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const tk = tokenFor(owner);
    const [svc] = await db.insert(services).values({ account_id: account.id, name: 'S', duration_minutes: 30, price: '10.00' }).returning();
    const staff = await seedUser(account.id, { role: 'staff' });

    // [método, ruta, body, estado, código]
    const cases = [
      ['POST', '/auth/register', {}, 400, 'missing_fields'],
      ['POST', '/auth/login', {}, 400, 'missing_fields'],
      ['POST', '/appointments', { scheduled_at: NOW_PLUS_DAY, client_id: crypto.randomUUID() }, 400, 'missing_fields'],
      ['POST', '/appointments', { service_id: svc.id, scheduled_at: 'no-es-fecha', client_id: crypto.randomUUID() }, 400, 'invalid_date'],
      ['PATCH', `/appointments/${crypto.randomUUID()}`, { status: 'cancelado' }, 400, 'invalid_field'],
      ['PATCH', `/appointments/${crypto.randomUUID()}`, {}, 400, 'empty_update'],
      ['POST', '/appointments/block', { scheduled_at: NOW_PLUS_DAY }, 400, 'missing_fields'],
      ['POST', '/appointments/block', { scheduled_at: 'x', scheduled_until: 'y' }, 400, 'invalid_date'],
      ['GET', '/appointments?date_from=abc', undefined, 400, 'invalid_date'],
      ['POST', '/services', { name: 'S' }, 400, 'missing_fields'],
      ['PATCH', `/services/${svc.id}/prices`, {}, 400, 'missing_fields'],
      ['PATCH', `/services/${crypto.randomUUID()}/prices`, {}, 400, 'missing_fields'], // el 400 precede al 404
      ['POST', '/clients', {}, 400, 'missing_fields'],
      ['POST', '/clients', { name: 'A' }, 400, 'email_or_phone_required'],
      ['POST', '/clients', { name: 'A', phone: '123' }, 400, 'invalid_phone_format'],
      ['PATCH', '/accounts/commission', { commission_rate: 1.5 }, 400, 'invalid_commission_rate'],
      ['PATCH', `/accounts/users/${crypto.randomUUID()}/commission`, { commission_rate: 'x' }, 400, 'invalid_commission_rate'], // precede al 404
      ['PATCH', '/me', { role: 'owner' }, 400, 'invalid_field'],
      ['PATCH', '/me', {}, 400, 'empty_update'],
      ['POST', '/staff', { name: 'A' }, 400, 'missing_fields'],
      ['POST', '/staff', { name: 'A', email: 'a@b.com', commission_rate: 2 }, 422, 'invalid_commission_rate'],
      ['PATCH', `/staff/${staff.id}`, { role: 'owner' }, 400, 'invalid_field'],
      ['PATCH', `/staff/${staff.id}`, {}, 400, 'empty_update'],
      ['PATCH', `/staff/${staff.id}`, { commission_rate: 2 }, 422, 'invalid_commission_rate'],
      ['PUT', `/staff/${staff.id}/availability`, {}, 400, 'invalid_body'],
      ['PUT', `/staff/${staff.id}/availability`, [1], 400, 'invalid_window'],
      ['PUT', `/staff/${staff.id}/availability`, [{ day_of_week: 1 }], 400, 'missing_fields'],
      ['PUT', `/staff/${staff.id}/availability`, [{ ...WIN, day_of_week: '1' }], 422, 'invalid_day_of_week'],
      ['PUT', `/staff/${staff.id}/availability`, [{ ...WIN, start_time: '9:00' }], 422, 'invalid_time_format'],
      ['PUT', `/staff/${staff.id}/availability`, [{ ...WIN, end_time: '09:00' }], 422, 'start_must_be_before_end'],
      ['GET', `/availability/${account.id}`, undefined, 400, 'missing_fields'],
      ['GET', '/payments?period=xxx', undefined, 400, 'invalid_period'],
      ['GET', '/payments?date_from=2026-13-45&date_to=2026-01-01', undefined, 400, 'invalid_period'],
      ['GET', '/payments?period=hoy&date_from=2026-01-01', undefined, 400, 'ambiguous_period_filter'],
      ['POST', '/public/bookings', {}, 400, 'missing_fields'],
      ['POST', '/public/bookings', { account_id: account.id, service_id: svc.id, scheduled_at: NOW_PLUS_DAY }, 400, 'client_required'],
      ['POST', '/public/bookings', { account_id: account.id, service_id: svc.id, scheduled_at: 12345, client: { name: 'A', email: 'a@b.com' } }, 400, 'invalid_scheduled_at'],
      ['POST', '/public/staff-invitations/activate', {}, 400, 'missing_fields'],
    ];

    for (const [method, path, body, status, code] of cases) {
      const res = await api.call(method, path, body, tk);
      assert.deepEqual([res.status, res.body], [status, { error: code }], `${method} ${path} ${JSON.stringify(body)}`);
    }
  }));

test('orden de evaluación del horario: alcance → estado → forma — RF-6', () =>
  withAccount(async (account) => {
    await withAccount(async (otra) => {
      const owner = await seedUser(account.id);
      const ajeno = await seedUser(otra.id, { role: 'staff' });
      const inactivo = await seedUser(account.id, { role: 'staff', status: 'inactivo' });
      const tk = tokenFor(owner);

      const a = await api.call('PUT', `/staff/${ajeno.id}/availability`, {}, tk);
      assert.deepEqual([a.status, a.body], [404, { error: 'not_found' }]);

      const b = await api.call('PUT', `/staff/${inactivo.id}/availability`, {}, tk);
      assert.deepEqual([b.status, b.body], [422, { error: 'user_inactive' }]);
    });
  }));
