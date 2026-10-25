// spec 011 T3 — consultas de turnos acotadas al cliente de la sesión (RF-7, RF-9).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { appointmentRepo } from '../../src/infrastructure/db/repositories/appointments.js';
import { users, clients, services, appointments } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

// Teléfonos aleatorios: los tests corren en paralelo sobre la misma base.
const phone = () => `+569${crypto.randomInt(10_000_000, 99_999_999)}`;
const HOUR = 60 * 60 * 1000;

const seed = async (accountId) => {
  const [mine, other] = await db.insert(clients).values([
    { account_id: accountId, name: 'Yo', phone: phone() },
    { account_id: accountId, name: 'Otro', phone: phone() },
  ]).returning();
  const [service] = await db.insert(services).values({ account_id: accountId, name: 'Corte', duration_minutes: 60, price: '1000' }).returning();
  const [pro] = await db.insert(users).values({
    account_id: accountId, name: 'Ana', email: `a-${crypto.randomUUID()}@test.com`, role: 'staff', password_hash: 'x',
  }).returning();
  const book = (client, inHours) => db.insert(appointments).values({
    account_id: accountId, client_id: client.id, service_id: service.id, assigned_user_id: pro.id,
    scheduled_at: new Date(Date.now() + inHours * HOUR), scheduled_until: new Date(Date.now() + (inHours + 1) * HOUR), status: 'agendado',
  }).returning().then(r => r[0]);
  return { mine, other, book };
};

test('findForList con clientId devuelve solo los turnos de ese cliente — RF-7', () =>
  withAccount(async (account) => {
    const { mine, other, book } = await seed(account.id);
    const a = await book(mine, 5);
    const b = await book(mine, 2);
    await book(other, 3);

    const rows = await appointmentRepo.findForList(db, { accountId: account.id, filters: { clientId: mine.id }, limit: 50 });
    assert.deepEqual(rows.map(r => r.id), [b.id, a.id]);
  }));

test('findForClient: undefined si el turno es de otro cliente o de otra cuenta — RF-9', () =>
  withAccount(async (account) => {
    const { mine, other, book } = await seed(account.id);
    const appt = await book(mine, 5);

    assert.equal((await appointmentRepo.findForClient(db, { id: appt.id, accountId: account.id, clientId: mine.id })).id, appt.id);
    assert.equal(await appointmentRepo.findForClient(db, { id: appt.id, accountId: account.id, clientId: other.id }), undefined);
    assert.equal(await appointmentRepo.findForClient(db, { id: appt.id, accountId: crypto.randomUUID(), clientId: mine.id }), undefined);
  }));
