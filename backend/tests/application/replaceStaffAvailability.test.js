import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceStaffAvailability } from '../../src/application/replaceStaffAvailability.js';

const makeRepos = (o = {}, calls = []) => ({
  users: {
    findVisible: async () => ({ id: 'stf-1', role: 'staff', status: 'activo' }),
    lockById: async () => { calls.push('lockById'); },
    ...o.users,
  },
  availability: {
    replaceForUser: async (tx, userId, windows) => { calls.push('replaceForUser'); return windows; },
    ...o.availability,
  },
  appointments: new Proxy({}, { get: (_, name) => () => { calls.push(`appointments.${String(name)}`); } }),
});

const makeDb = (calls) => ({ transaction: async (fn) => { calls.push('transaction'); return fn({}); } });
const owner = { id: 'own-1', role: 'owner' };
const win = { day_of_week: 1, start_time: '09:00', end_time: '13:00' };
const base = (body = [win]) => ({ id: 'stf-1', accountId: 'acc-1', actor: owner, body });

// T07 — orden de evaluación (RF-10, RF-11)

test('trabajador ajeno + cuerpo inválido → 404, no 400/422', async () => {
  const calls = [];
  const repos = makeRepos({ users: { findVisible: async () => undefined } }, calls);
  await assert.rejects(() => replaceStaffAvailability(makeDb(calls), base('basura'), repos), { status: 404 }); // RF-10
  assert.deepEqual(calls, []);
});

test('id de owner → 404', async () => {
  const repos = makeRepos({ users: { findVisible: async () => ({ id: 'own-2', role: 'owner', status: 'activo' }) } });
  await assert.rejects(() => replaceStaffAvailability(makeDb([]), base(), repos), { status: 404 }); // RF-15
});

test('staff sobre un compañero → 404', async () => {
  const repos = makeRepos();
  await assert.rejects(
    () => replaceStaffAvailability(makeDb([]), { ...base(), actor: { id: 'stf-2', role: 'staff' } }, repos),
    { status: 404 }, // RF-14, RF-15
  );
});

test('inactivo + cuerpo inválido → 422 por estado, antes de validar el cuerpo', async () => {
  const repos = makeRepos({ users: { findVisible: async () => ({ id: 'stf-1', role: 'staff', status: 'inactivo' }) } });
  await assert.rejects(() => replaceStaffAvailability(makeDb([]), base('basura'), repos), { status: 422, message: 'user_inactive' }); // RF-10, RF-11
});

test('pendiente + cuerpo válido → ok', async () => {
  const repos = makeRepos({ users: { findVisible: async () => ({ id: 'stf-1', role: 'staff', status: 'pendiente' }) } });
  const out = await replaceStaffAvailability(makeDb([]), base(), repos);
  assert.deepEqual(out, [win]); // RF-11
});

test('cuerpo inválido no abre transacción ni escribe', async () => {
  const calls = [];
  const repos = makeRepos({}, calls);
  await assert.rejects(() => replaceStaffAvailability(makeDb(calls), base('basura'), repos), { status: 400 }); // RF-5
  await assert.rejects(
    () => replaceStaffAvailability(makeDb(calls), base([win, { ...win, start_time: '12:00', end_time: '14:00' }]), repos),
    { status: 422 }, // RF-9
  );
  assert.deepEqual(calls, []);
});

// T08 — escritura (RF-3, RF-4, RF-12)

test('lockById antes de replaceForUser, ambos dentro de la transacción; no toca appointments', async () => {
  const calls = [];
  const repos = makeRepos({}, calls);
  const out = await replaceStaffAvailability(makeDb(calls), base(), repos);
  assert.deepEqual(calls, ['transaction', 'lockById', 'replaceForUser']); // RF-3, RNF concurrencia, RF-12
  assert.deepEqual(out, [win]);
});

test('lista vacía → reemplaza por nada y devuelve []', async () => {
  const out = await replaceStaffAvailability(makeDb([]), base([]), makeRepos());
  assert.deepEqual(out, []); // RF-4
});

test('la respuesta lleva las horas en HH:MM', async () => {
  const repos = makeRepos({ availability: { replaceForUser: async () => [{ day_of_week: 1, start_time: '09:00:00', end_time: '13:00:00' }] } });
  assert.deepEqual(await replaceStaffAvailability(makeDb([]), base(), repos), [win]); // RF-2
});

test('errores de constraint de la DB (23P01, 23514) → 422; otros se propagan', async () => {
  for (const code of ['23P01', '23514']) {
    const repos = makeRepos({ availability: { replaceForUser: async () => { throw Object.assign(new Error('boom'), { cause: { code } }); } } });
    await assert.rejects(() => replaceStaffAvailability(makeDb([]), base(), repos), { status: 422 });
  }
  const repos = makeRepos({ availability: { replaceForUser: async () => { throw new Error('conexión caída'); } } });
  await assert.rejects(() => replaceStaffAvailability(makeDb([]), base(), repos), { message: 'conexión caída' });
});
