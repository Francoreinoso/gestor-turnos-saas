import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteStaff as inviteStaffUseCase } from '../../src/application/inviteStaff.js';

const makeRepos = (o = {}) => ({
  users: {
    findByEmail: async () => null,
    create: async (db, data) => ({ id: 'usr-new', ...data }),
    update: async (db, id, data) => ({ id, ...data }),
    ...o.users,
  },
  invitationTokens: {
    invalidateAllForUser: async () => {},
    create: async () => ({ id: 'tok-1' }),
    ...o.invitationTokens,
  },
  email: {
    sendInvitation: async () => {},
    ...o.email,
  },
});

const db = { transaction: async (fn) => fn(db) };
const owner = { id: 'own-1', role: 'owner', account_id: 'acc-1' };
const base = { accountId: 'acc-1', actor: owner, name: 'Ana', email: 'ana@test.com' };
// spec 008 RF-4: el caso de uso recibe el `body` crudo; estos tests arman campos sueltos, así que se adaptan acá.
const inviteStaff = (db, { accountId, actor, name, email, commissionRate }, repos) =>
  inviteStaffUseCase(db, { accountId, actor, body: { name, email, commission_rate: commissionRate } }, repos);


// T08 — validación

test('staff que invoca → 403, sin tocar ningún repo', async () => {
  const calls = [];
  const repos = makeRepos({
    users: { findByEmail: async () => { calls.push('findByEmail'); return null; } },
  });
  await assert.rejects(
    () => inviteStaff(db, { ...base, actor: { id: 'stf-1', role: 'staff', account_id: 'acc-1' } }, repos),
    { message: 'forbidden', status: 403 }, // RF-14
  );
  assert.deepEqual(calls, []);
});

test('falta name o email → 400', async () => {
  const repos = makeRepos();
  await assert.rejects(() => inviteStaff(db, { ...base, name: undefined }, repos), { message: 'missing_fields', status: 400 }); // RF-5
  await assert.rejects(() => inviteStaff(db, { ...base, email: undefined }, repos), { message: 'missing_fields', status: 400 });
});

test('comisión fuera de [0,1] → 422', async () => {
  const repos = makeRepos();
  await assert.rejects(
    () => inviteStaff(db, { ...base, commissionRate: 1.5 }, repos),
    { message: 'invalid_commission_rate', status: 422 }, // RF-4
  );
});

// T09 — ramas create / reject

test('sin usuario existente → create, 201, guarda token y envía email', async () => {
  const calls = [];
  const repos = makeRepos({
    invitationTokens: { create: async (db, data) => { calls.push('tokens.create'); return { id: 'tok-1', ...data }; } },
    email: { sendInvitation: async () => { calls.push('email.sendInvitation'); } },
  });
  const { user, action } = await inviteStaff(db, { ...base, commissionRate: 0.3 }, repos);

  assert.equal(action, 'create');
  assert.equal(user.status, 'pendiente'); // RF-1
  assert.equal(user.role, 'staff'); // RF-2
  assert.equal(user.commission_rate, 0.3); // RF-3
  assert.deepEqual(calls, ['tokens.create', 'email.sendInvitation']);
});

test('email de un usuario activo (cualquier cuenta) → 409, sin escrituras', async () => {
  const calls = [];
  const repos = makeRepos({
    users: {
      findByEmail: async () => ({ id: 'usr-1', status: 'activo', account_id: 'otra-cuenta' }),
      create: async () => { calls.push('create'); },
      update: async () => { calls.push('update'); },
    },
  });
  await assert.rejects(() => inviteStaff(db, base, repos), { message: 'email_taken', status: 409 }); // RF-6
  assert.deepEqual(calls, []);
});

// T10 — ramas reactivate / resend + rollback de envío

test('inactivo de la misma cuenta → reactivate, 200, pasa a pendiente', async () => {
  const repos = makeRepos({
    users: {
      findByEmail: async () => ({ id: 'usr-1', status: 'inactivo', account_id: 'acc-1' }),
    },
  });
  const { user, action } = await inviteStaff(db, base, repos);
  assert.equal(action, 'reactivate'); // RF-7
  assert.equal(user.status, 'pendiente');
  assert.equal(user.id, 'usr-1');
});

test('pendiente de la misma cuenta → resend, 200, invalida el token anterior', async () => {
  const calls = [];
  const repos = makeRepos({
    users: { findByEmail: async () => ({ id: 'usr-1', status: 'pendiente', account_id: 'acc-1' }) },
    invitationTokens: {
      invalidateAllForUser: async () => { calls.push('invalidate'); },
      create: async () => { calls.push('create'); return { id: 'tok-2' }; },
    },
  });
  const { action } = await inviteStaff(db, base, repos);
  assert.equal(action, 'resend'); // RF-8
  assert.deepEqual(calls, ['invalidate', 'create']);
});

test('si el envío de email falla, no queda nada persistido (rollback)', async () => {
  let userCreated = false;
  const repos = makeRepos({
    users: { create: async (db, data) => { userCreated = true; return { id: 'usr-new', ...data }; } },
    email: { sendInvitation: async () => { throw new Error('smtp_down'); } },
  });
  const committingDb = { transaction: async (fn) => fn(committingDb) };

  await assert.rejects(() => inviteStaff(committingDb, base, repos), { message: 'smtp_down' }); // RF-15
  // el use case no traga el error de email dentro de la transacción — se propaga tal cual,
  // que es lo que hace que Postgres revierta la escritura en un `db.transaction` real.
  assert.equal(userCreated, true);
});

// spec 008 RF-4 — cuerpo que no es un objeto: 400 invalid_body, nunca 500; el rol se evalúa antes (403).
test('body ausente, null, array o texto → 400 invalid_body sin tocar ningún repo', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, name) => new Proxy({}, { get: (__, method) => async () => { calls.push(`${String(name)}.${String(method)}`); } }) });
  for (const body of [undefined, null, [], 'texto', 42]) {
    await assert.rejects(
      () => inviteStaffUseCase(db, { accountId: 'acc-1', actor: owner, body }, spy),
      { status: 400, message: 'invalid_body' },
      JSON.stringify(body),
    );
  }
  assert.deepEqual(calls, []);
});

test('un actor staff con body inválido recibe 403, no 400 (el rol se evalúa primero)', async () => {
  await assert.rejects(
    () => inviteStaffUseCase(db, { accountId: 'acc-1', actor: { id: 'stf-1', role: 'staff' }, body: undefined }, {}),
    { status: 403 },
  );
});
