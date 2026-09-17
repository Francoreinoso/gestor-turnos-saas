import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resendStaffInvitation } from '../../src/application/resendStaffInvitation.js';

const makeRepos = (o = {}) => ({
  users: {
    findVisible: async () => ({ id: 'usr-1', email: 'ana@test.com', status: 'pendiente' }),
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

test('staff que invoca → 403', async () => {
  const repos = makeRepos();
  await assert.rejects(
    () => resendStaffInvitation(db, { ...base, actor: { id: 'stf-1', role: 'staff' } }, repos),
    { status: 403 },
  );
});

test('trabajador fuera de alcance → 404', async () => {
  const repos = makeRepos({ users: { findVisible: async () => undefined } });
  await assert.rejects(() => resendStaffInvitation(db, base, repos), { message: 'not_found', status: 404 }); // RF-34
});

test('status distinto de pendiente → 422', async () => {
  const repos = makeRepos({ users: { findVisible: async () => ({ id: 'usr-1', status: 'activo' }) } });
  await assert.rejects(() => resendStaffInvitation(db, base, repos), { status: 422 }); // RF-13
});

test('pendiente → invalida el token anterior antes de crear uno nuevo y envía', async () => {
  const calls = [];
  const repos = makeRepos({
    invitationTokens: {
      invalidateAllForUser: async () => { calls.push('invalidate'); },
      create: async () => { calls.push('create'); return { id: 'tok-2' }; },
    },
    email: { sendInvitation: async () => { calls.push('email'); } },
  });
  const { user } = await resendStaffInvitation(db, base, repos);
  assert.equal(user.id, 'usr-1');
  assert.deepEqual(calls, ['invalidate', 'create', 'email']); // RF-12
});
