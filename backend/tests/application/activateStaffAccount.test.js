import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateStaffAccount } from '../../src/application/activateStaffAccount.js';

const makeRepos = (o = {}) => ({
  invitationTokens: {
    findValidByHash: async () => ({ id: 'tok-1', user_id: 'usr-1' }),
    markUsed: async () => {},
    ...o.invitationTokens,
  },
  users: {
    update: async (db, id, data) => ({ id, ...data }),
    ...o.users,
  },
});

const db = { transaction: async (fn) => fn(db) };

test('token vencido o usado → 410', async () => {
  const repos = makeRepos({ invitationTokens: { findValidByHash: async () => undefined } });
  await assert.rejects(
    () => activateStaffAccount(db, { token: 'abc', password: 'nueva123' }, repos),
    { status: 410 }, // RF-10
  );
});

test('token válido → guarda password_hash, activa y marca el token usado', async () => {
  const calls = [];
  const repos = makeRepos({
    users: { update: async (db, id, data) => { calls.push(['update', id, data]); return { id, ...data }; } },
    invitationTokens: {
      findValidByHash: async () => ({ id: 'tok-1', user_id: 'usr-1' }),
      markUsed: async (db, id) => { calls.push(['markUsed', id]); },
    },
  });
  const { user } = await activateStaffAccount(db, { token: 'abc', password: 'nueva123' }, repos);

  assert.equal(user.status, 'activo'); // RF-11
  assert.ok(user.password_hash);
  assert.notEqual(user.password_hash, 'nueva123');
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[1][0], 'markUsed');
  assert.equal(calls[1][1], 'tok-1');
});
