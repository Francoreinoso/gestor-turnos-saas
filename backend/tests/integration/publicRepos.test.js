import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { accountRepo } from '../../src/infrastructure/db/repositories/accounts.js';
import { appointmentRepo } from '../../src/infrastructure/db/repositories/appointments.js';
import { users, clients, services, appointments } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const HOUR = 60 * 60 * 1000;

test('accountRepo.findById: devuelve la cuenta y undefined para otra — spec 005 RF-1', () =>
  withAccount(async (account) => {
    const found = await accountRepo.findById(db, account.id);
    assert.equal(found.business_name, 'Test');
    assert.equal(await accountRepo.findById(db, crypto.randomUUID()), undefined);
  }));

test('appointmentRepo.findTakenSlots: omite cancelados, respeta el rango y devuelve columnas mínimas — spec 005 RF-9', () =>
  withAccount(async (account) => {
    const [staff] = await db.insert(users).values({
      account_id: account.id, name: 'Pro', email: `p-${crypto.randomUUID()}@test.com`, role: 'staff', status: 'activo', password_hash: 'x',
    }).returning();
    const [client] = await db.insert(clients).values({ account_id: account.id, name: 'Cli', email: 'cli@test.com' }).returning();
    const [service] = await db.insert(services).values({ account_id: account.id, name: 'Corte', duration_minutes: 60, price: '100' }).returning();
    const base = new Date('2030-01-01T10:00:00Z');
    const at = (h) => new Date(base.getTime() + h * HOUR);
    const mk = (startH, endH, status) => ({
      account_id: account.id, client_id: client.id, service_id: service.id, assigned_user_id: staff.id, scheduled_at: at(startH), scheduled_until: at(endH), status,
    });
    await db.insert(appointments).values([
      mk(0, 1, 'agendado'),      // dentro del rango
      mk(1, 2, 'cancelado'),     // cancelado: no cuenta
      mk(10, 11, 'agendado'),    // fuera del rango
    ]);

    const taken = await appointmentRepo.findTakenSlots(db, { accountId: account.id, from: at(0), to: at(5) });

    assert.equal(taken.length, 1);
    assert.deepEqual(Object.keys(taken[0]).sort(), ['assigned_user_id', 'scheduled_at', 'scheduled_until']);
    assert.equal(taken[0].assigned_user_id, staff.id);
  }));
