import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editStaff } from '../../src/application/editStaff.js';

const makeRepos = (o = {}) => ({
  users: {
    findVisible: async () => ({ id: 'usr-1', account_id: 'acc-1', email: 'ana@test.com', status: 'activo' }),
    findByEmail: async () => null,
    update: async (db, id, data) => ({ id, ...data }),
    ...o.users,
  },
  invitationTokens: {
    invalidateAllForUser: async () => {},
    create: async () => ({ id: 'tok-2' }),
    ...o.invitationTokens,
  },
  email: { sendInvitation: async () => {}, ...o.email },
});

const db = { transaction: async (fn) => fn(db) };
const owner = { id: 'own-1', role: 'owner' };
const base = { id: 'usr-1', accountId: 'acc-1', actor: owner };

// T12 — whitelist, guarda inactivo y visibilidad

test('staff que invoca → 404', async () => {
  const repos = makeRepos();
  await assert.rejects(
    () => editStaff(db, { ...base, actor: { id: 'stf-1', role: 'staff' }, body: { name: 'x' } }, repos),
    { status: 404 }, // RF-24
  );
});

test('payload vacío o con campo no permitido → 400', async () => {
  const repos = makeRepos();
  await assert.rejects(() => editStaff(db, { ...base, body: {} }, repos), { status: 400 }); // RF-23
  await assert.rejects(() => editStaff(db, { ...base, body: { status: 'inactivo' } }, repos), { status: 400 });
});

test('trabajador inactivo → 422', async () => {
  const repos = makeRepos({ users: { findVisible: async () => ({ id: 'usr-1', status: 'inactivo' }) } });
  await assert.rejects(() => editStaff(db, { ...base, body: { name: 'x' } }, repos), { status: 422 }); // RF-17
});

test('trabajador fuera de cuenta → 404', async () => {
  const repos = makeRepos({ users: { findVisible: async () => undefined } });
  await assert.rejects(() => editStaff(db, { ...base, body: { name: 'x' } }, repos), { status: 404 }); // RF-34
});

test('owner edita nombre, email y comisión de un trabajador activo → 200 con los datos aplicados', async () => {
  const repos = makeRepos({
    users: {
      findVisible: async () => ({ id: 'usr-1', email: 'viejo@test.com', status: 'activo' }),
      findByEmail: async () => null,
      update: async (db, id, data) => ({ id, ...data }),
    },
  });
  const { user } = await editStaff(db, {
    ...base, body: { name: 'Nombre Nuevo', email: 'nuevo@test.com', commission_rate: 0.25 },
  }, repos);
  assert.equal(user.name, 'Nombre Nuevo'); // RF-16
  assert.equal(user.email, 'nuevo@test.com');
  assert.equal(user.commission_rate, 0.25);
});

// T13 — email duplicado, reemisión y comisión

test('email ya ocupado por otro usuario → 409, sin reactivar', async () => {
  const updateCalls = [];
  const repos = makeRepos({
    users: {
      findVisible: async () => ({ id: 'usr-1', email: 'ana@test.com', status: 'activo' }),
      findByEmail: async () => ({ id: 'otro-usr', status: 'inactivo' }),
      update: async (db, id, data) => { updateCalls.push(id); return { id, ...data }; },
    },
  });
  await assert.rejects(
    () => editStaff(db, { ...base, body: { email: 'ocupado@test.com' } }, repos),
    { message: 'email_taken', status: 409 }, // RF-22
  );
  assert.deepEqual(updateCalls, []);
});

test('cambiar email de un trabajador pendiente reemite la invitación', async () => {
  const calls = [];
  const repos = makeRepos({
    users: {
      findVisible: async () => ({ id: 'usr-1', email: 'viejo@test.com', status: 'pendiente' }),
      findByEmail: async () => null,
      update: async (db, id, data) => { calls.push('update'); return { id, ...data }; },
    },
    invitationTokens: {
      invalidateAllForUser: async () => { calls.push('invalidate'); },
      create: async () => { calls.push('create'); return { id: 'tok-2' }; },
    },
    email: { sendInvitation: async () => { calls.push('email'); } },
  });
  const { user } = await editStaff(db, { ...base, body: { email: 'nuevo@test.com' } }, repos);
  assert.equal(user.email, 'nuevo@test.com');
  assert.deepEqual(calls, ['update', 'invalidate', 'create', 'email']); // RF-18
});

test('commission_rate: null limpia la comisión propia', async () => {
  const repos = makeRepos({
    users: {
      findVisible: async () => ({ id: 'usr-1', email: 'ana@test.com', status: 'activo' }),
      update: async (db, id, data) => ({ id, ...data }),
    },
  });
  const { user } = await editStaff(db, { ...base, body: { commission_rate: null } }, repos);
  assert.equal(user.commission_rate, null); // RF-19
});
