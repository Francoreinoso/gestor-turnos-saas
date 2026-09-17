import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { staffInvitationTokenRepo } from '../../src/infrastructure/db/repositories/staffInvitationTokens.js';
import { userRepo } from '../../src/infrastructure/db/repositories/users.js';
import { appointmentRepo } from '../../src/infrastructure/db/repositories/appointments.js';
import { users, clients, services } from '../../db/schema.js';

before(setupDb);
after(teardownDb);

const HOUR = 60 * 60 * 1000;

async function seedStaff(accountId, overrides = {}) {
  return db.insert(users).values({
    account_id: accountId,
    name: overrides.name ?? 'Trabajador',
    email: overrides.email ?? `t-${crypto.randomUUID()}@test.com`,
    role: 'staff',
    status: overrides.status ?? 'activo',
    password_hash: overrides.password_hash ?? 'x',
  }).returning().then(r => r[0]);
}

test('staffInvitationTokenRepo: invalidar el anterior deja solo el nuevo como válido — RF-9, RF-10, RF-12', () =>
  withAccount(async (account) => {
    const user = await seedStaff(account.id, { status: 'pendiente' });
    const expiresAt = new Date(Date.now() + 72 * HOUR);

    const first = await staffInvitationTokenRepo.create(db, { user_id: user.id, token_hash: 'hash-1', expires_at: expiresAt });
    assert.ok(await staffInvitationTokenRepo.findValidByHash(db, 'hash-1'));

    await staffInvitationTokenRepo.invalidateAllForUser(db, user.id);
    const second = await staffInvitationTokenRepo.create(db, { user_id: user.id, token_hash: 'hash-2', expires_at: expiresAt });

    assert.equal(await staffInvitationTokenRepo.findValidByHash(db, 'hash-1'), undefined);
    assert.ok(await staffInvitationTokenRepo.findValidByHash(db, 'hash-2'));

    await staffInvitationTokenRepo.markUsed(db, second.id);
    assert.equal(await staffInvitationTokenRepo.findValidByHash(db, 'hash-2'), undefined);
  }));

test('userRepo.findManyByAccount: orden alfabético y filtro de estado — RF-31, RF-32', () =>
  withAccount(async (account) => {
    await seedStaff(account.id, { name: 'Carla', status: 'activo' });
    await seedStaff(account.id, { name: 'Ana', status: 'pendiente' });
    await seedStaff(account.id, { name: 'Beto', status: 'inactivo' });

    const all = await userRepo.findManyByAccount(db, account.id);
    assert.deepEqual(all.map(u => u.name), ['Ana', 'Beto', 'Carla']);

    const onlyActive = await userRepo.findManyByAccount(db, account.id, { status: 'activo' });
    assert.deepEqual(onlyActive.map(u => u.name), ['Carla']);
  }));

test('userRepo.findVisible: undefined fuera de cuenta — RF-24, RF-34', () =>
  withAccount(async (account) => {
    const user = await seedStaff(account.id);
    assert.ok(await userRepo.findVisible(db, { id: user.id, accountId: account.id }));
    assert.equal(await userRepo.findVisible(db, { id: user.id, accountId: crypto.randomUUID() }), undefined);
  }));

test('appointmentRepo.cancelFutureForUser: solo agendado/bloqueado futuros — RF-26, RF-27', () =>
  withAccount(async (account) => {
    const staff = await seedStaff(account.id);
    const now = new Date();

    const client = await db.insert(clients).values({
      account_id: account.id, name: 'Cliente', email: `c-${crypto.randomUUID()}@test.com`,
    }).returning().then(r => r[0]);
    const service = await db.insert(services).values({
      account_id: account.id, name: 'Corte', duration_minutes: 30, price: '10.00',
    }).returning().then(r => r[0]);
    const withRefs = { client_id: client.id, service_id: service.id };

    const futureAppointment = await appointmentRepo.create(db, {
      account_id: account.id, assigned_user_id: staff.id, status: 'agendado', ...withRefs,
      scheduled_at: new Date(now.getTime() + HOUR), scheduled_until: new Date(now.getTime() + 2 * HOUR),
    });
    const futureBlock = await appointmentRepo.create(db, {
      account_id: account.id, assigned_user_id: staff.id, status: 'bloqueado',
      scheduled_at: new Date(now.getTime() + 3 * HOUR), scheduled_until: new Date(now.getTime() + 4 * HOUR),
    });
    const pastCompleted = await appointmentRepo.create(db, {
      account_id: account.id, assigned_user_id: staff.id, status: 'completado', ...withRefs,
      scheduled_at: new Date(now.getTime() - 4 * HOUR), scheduled_until: new Date(now.getTime() - 3 * HOUR),
    });

    await appointmentRepo.cancelFutureForUser(db, { userId: staff.id, now });

    assert.equal((await appointmentRepo.findById(db, futureAppointment.id)).status, 'cancelado');
    assert.equal((await appointmentRepo.findById(db, futureBlock.id)).status, 'cancelado');
    assert.equal((await appointmentRepo.findById(db, pastCompleted.id)).status, 'completado');
  }));
