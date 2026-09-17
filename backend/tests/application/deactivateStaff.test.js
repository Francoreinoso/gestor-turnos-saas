import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deactivateStaff } from '../../src/application/deactivateStaff.js';

const makeRepos = (o = {}) => ({
  users: {
    findVisible: async () => ({ id: 'usr-1', status: 'activo' }),
    update: async (db, id, data) => ({ id, ...data }),
    ...o.users,
  },
  appointments: {
    cancelFutureForUser: async () => {},
    ...o.appointments,
  },
});

const db = { transaction: async (fn) => fn(db) };
const owner = { id: 'own-1', role: 'owner' };
const base = { id: 'usr-1', accountId: 'acc-1', actor: owner, now: new Date('2026-01-01T00:00:00Z') };

// T15 — guardas de rol y estado

test('staff que invoca (sobre sí o sobre otro) → 403, sin cargar el recurso', async () => {
  const calls = [];
  const repos = makeRepos({ users: { findVisible: async () => { calls.push('findVisible'); return { id: 'usr-1', status: 'activo' }; } } });
  await assert.rejects(
    () => deactivateStaff(db, { ...base, actor: { id: 'stf-1', role: 'staff' } }, repos),
    { status: 403 }, // RF-29
  );
  assert.deepEqual(calls, []);
});

test('trabajador ya inactivo → 422, sin llamar a update', async () => {
  const calls = [];
  const repos = makeRepos({
    users: {
      findVisible: async () => ({ id: 'usr-1', status: 'inactivo' }),
      update: async () => { calls.push('update'); },
    },
  });
  await assert.rejects(() => deactivateStaff(db, base, repos), { status: 422 }); // RF-28
  assert.deepEqual(calls, []);
});

test('trabajador fuera de cuenta → 404', async () => {
  const repos = makeRepos({ users: { findVisible: async () => undefined } });
  await assert.rejects(() => deactivateStaff(db, base, repos), { status: 404 }); // RF-34
});

// T16 — transición y cascada

test('marca inactivo y cancela turnos/bloqueos futuros en la misma transacción', async () => {
  const calls = [];
  const repos = makeRepos({
    users: { update: async (db, id, data) => { calls.push(['update', id, data]); return { id, ...data }; } },
    appointments: { cancelFutureForUser: async (db, args) => { calls.push(['cancelFutureForUser', args]); } },
  });
  const { user } = await deactivateStaff(db, base, repos);
  assert.equal(user.status, 'inactivo'); // RF-25
  assert.deepEqual(calls, [
    ['update', 'usr-1', { status: 'inactivo' }],
    ['cancelFutureForUser', { userId: 'usr-1', now: base.now }], // RF-26, RF-27
  ]);
});
