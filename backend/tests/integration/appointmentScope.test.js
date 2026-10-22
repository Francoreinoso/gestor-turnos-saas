// spec 010 RF-2 — todas las rutas /appointments/:id… acotan por rol: un staff ajeno recibe 404 y no cambia nada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { users, clients, services, appointments, payments } from '../../db/schema.js';

let api;
before(async () => { await setupDb(); api = await startApiServer(); });
after(async () => { await api.close(); await teardownDb(); });

const HOUR = 60 * 60 * 1000;

const seedUser = (accountId, role) =>
  db.insert(users).values({
    account_id: accountId, name: role, email: `u-${crypto.randomUUID()}@test.com`, role, password_hash: 'x',
  }).returning().then(r => r[0]);

const seedAppointment = async (accountId, userId, status, startsAt) => {
  const [client] = await db.insert(clients).values({ account_id: accountId, name: 'Cli', email: `c-${crypto.randomUUID()}@t.com` }).returning();
  const [service] = await db.insert(services).values({ account_id: accountId, name: 'Svc', duration_minutes: 60, price: '50.00' }).returning();
  return db.insert(appointments).values({
    account_id: accountId, client_id: status === 'bloqueado' ? null : client.id, service_id: status === 'bloqueado' ? null : service.id, assigned_user_id: userId,
    scheduled_at: startsAt, scheduled_until: new Date(startsAt.getTime() + HOUR), status,
  }).returning().then(r => r[0]);
};

const snapshot = async (id) => ({
  appointment: await db.select().from(appointments).where(eq(appointments.id, id)).then(r => r[0]),
  payments: await db.select().from(payments).where(eq(payments.appointment_id, id)),
});

test('staff ajeno recibe 404 en GET, PATCH, cancel, cancel-block y correct — RF-1, RF-2', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id, 'owner');
    const staffA = await seedUser(account.id, 'staff');
    const staffB = await seedUser(account.id, 'staff');
    const tkB = tokenFor(staffB);

    const completed = await seedAppointment(account.id, staffA.id, 'completado', new Date(Date.now() - 3 * HOUR));
    const scheduled = await seedAppointment(account.id, staffA.id, 'agendado', new Date(Date.now() + 24 * HOUR));
    const block = await seedAppointment(account.id, staffA.id, 'bloqueado', new Date(Date.now() + 48 * HOUR));
    const businessBlock = await seedAppointment(account.id, null, 'bloqueado', new Date(Date.now() + 72 * HOUR));

    const before = await Promise.all([completed, scheduled, block, businessBlock].map(a => snapshot(a.id)));

    const calls = [
      ['GET', `/appointments/${scheduled.id}`],
      ['PATCH', `/appointments/${scheduled.id}`, { notes: 'hack' }],
      ['PATCH', `/appointments/${scheduled.id}/cancel`],
      ['PATCH', `/appointments/${block.id}/cancel-block`],
      ['PATCH', `/appointments/${completed.id}/correct`],
      ['PATCH', `/appointments/${scheduled.id}/correct`], // agendado ajeno: 404, no 422
      ['PATCH', `/appointments/${businessBlock.id}/correct`],
    ];
    for (const [method, path, body] of calls) {
      const res = await api.call(method, path, body, tkB);
      assert.equal(res.status, 404, `${method} ${path} → ${res.status} ${res.text}`);
    }

    const after = await Promise.all([completed, scheduled, block, businessBlock].map(a => snapshot(a.id)));
    assert.deepEqual(after, before);

    // el owner conserva el alcance completo
    const ownerTk = tokenFor(owner);
    assert.equal((await api.call('GET', `/appointments/${scheduled.id}`, undefined, ownerTk)).status, 200);
    assert.equal((await api.call('PATCH', `/appointments/${completed.id}/correct`, undefined, ownerTk)).status, 200);
    // y el staff propio también
    const tkA = tokenFor(staffA);
    assert.equal((await api.call('PATCH', `/appointments/${completed.id}/correct`, undefined, tkA)).status, 200);
  }));
