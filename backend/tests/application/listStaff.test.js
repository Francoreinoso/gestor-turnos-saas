import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listStaff } from '../../src/application/listStaff.js';

const makeRepos = (o = {}) => ({
  users: {
    findManyByAccount: async () => [{ id: 'usr-1' }],
    ...o.users,
  },
});

const db = {};
const owner = { id: 'own-1', role: 'owner' };

test('staff que invoca → 403', async () => {
  const repos = makeRepos();
  await assert.rejects(
    () => listStaff(db, { accountId: 'acc-1', actor: { id: 'stf-1', role: 'staff' } }, repos),
    { status: 403 }, // RF-33
  );
});

test('pasa el filtro de estado al repo tal cual', async () => {
  let received;
  const repos = makeRepos({
    users: { findManyByAccount: async (db, accountId, filter) => { received = filter; return []; } },
  });
  await listStaff(db, { accountId: 'acc-1', actor: owner, status: 'pendiente' }, repos);
  assert.deepEqual(received, { status: 'pendiente' }); // RF-31, RF-32
});
