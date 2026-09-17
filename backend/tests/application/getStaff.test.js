import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStaff } from '../../src/application/getStaff.js';

const makeRepos = (o = {}) => ({
  users: {
    findVisible: async () => ({ id: 'usr-1', name: 'Ana', status: 'activo' }),
    ...o.users,
  },
});

const db = {};
const owner = { id: 'own-1', role: 'owner' };
const base = { id: 'usr-1', accountId: 'acc-1', actor: owner };

test('trabajador fuera de cuenta → 404', async () => {
  const repos = makeRepos({ users: { findVisible: async () => undefined } });
  await assert.rejects(() => getStaff(db, base, repos), { status: 404 }); // RF-34
});

test('devuelve el trabajador visible', async () => {
  const repos = makeRepos();
  const { user } = await getStaff(db, base, repos);
  assert.equal(user.id, 'usr-1');
});
