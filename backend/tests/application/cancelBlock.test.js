import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelBlock } from '../../src/application/cancelBlock.js';

const BLOCK = { id: 'b-1', account_id: 'acc-1', assigned_user_id: 'usr-1', status: 'bloqueado' };

const makeRepos = (o = {}) => ({
  appointments: {
    findVisible: async () => ({ ...BLOCK }),
    update: async (db, id, patch) => ({ ...BLOCK, ...patch }),
    delete: async () => { throw new Error('DELETE físico no permitido'); },
    ...o.appointments,
  },
});

const db = {};
const owner = { id: 'own', role: 'owner' };
const ctx = (o = {}) => ({ id: 'b-1', accountId: 'acc-1', actor: owner, ...o });

test('RF-46: cancela con baja lógica y sin DELETE', async () => {
  let deleted = false;
  const repos = makeRepos({ appointments: { findVisible: async () => ({ ...BLOCK }), update: async (d, i, p) => ({ ...BLOCK, ...p }), delete: async () => { deleted = true; } } });
  const res = await cancelBlock(db, ctx(), repos);
  assert.equal(res.status, 'cancelado');
  assert.equal(deleted, false);
});

test('RF-47: inexistente → 404', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => null } });
  await assert.rejects(() => cancelBlock(db, ctx(), repos), { message: 'not_found', status: 404 });
});

test('RF-47: no es un bloqueo / ya cancelado → 422', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => ({ ...BLOCK, status: 'cancelado' }) } });
  await assert.rejects(() => cancelBlock(db, ctx(), repos), { message: 'invalid_status_transition', status: 422 });
});

test('RF-32/RF-48: staff sobre bloqueo de negocio → 404', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => ({ ...BLOCK, assigned_user_id: null }) } });
  await assert.rejects(
    () => cancelBlock(db, ctx({ actor: { id: 'usr-1', role: 'staff' } }), repos),
    { message: 'not_found', status: 404 },
  );
});

test('RF-30: owner sí puede cancelar un bloqueo de negocio', async () => {
  const repos = makeRepos({
    appointments: {
      findVisible: async () => ({ ...BLOCK, assigned_user_id: null }),
      update: async (d, i, p) => ({ ...BLOCK, assigned_user_id: null, ...p }),
      delete: async () => { throw new Error('no'); },
    },
  });
  const res = await cancelBlock(db, ctx(), repos); // ctx() usa actor owner
  assert.equal(res.status, 'cancelado');
});
