import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editOwnProfile } from '../../src/application/editOwnProfile.js';

const makeRepos = (o = {}) => ({
  users: {
    update: async (db, id, data) => ({ id, ...data }),
    ...o.users,
  },
});

const db = {};
const actor = { id: 'usr-1', role: 'staff' };

test('email/role/commission_rate en el payload propio → 400', async () => {
  const repos = makeRepos();
  await assert.rejects(() => editOwnProfile(db, { actor, body: { email: 'a@b.com' } }, repos), { status: 400 }); // RF-21
});

test('cambia el propio nombre', async () => {
  const repos = makeRepos();
  const { user } = await editOwnProfile(db, { actor, body: { name: 'Nuevo Nombre' } }, repos);
  assert.equal(user.name, 'Nuevo Nombre'); // RF-20
});

test('cambia la contraseña: guarda un hash, no el texto plano', async () => {
  let saved;
  const repos = makeRepos({ users: { update: async (db, id, data) => { saved = data; return { id, ...data }; } } });
  const { user } = await editOwnProfile(db, { actor, body: { password: 'plano123' } }, repos);
  assert.ok(saved.password_hash);
  assert.notEqual(saved.password_hash, 'plano123');
  assert.equal(user.password_hash, undefined); // spec 009 RF-1: el hash nunca sale
  assert.equal(user.password, undefined);
});
