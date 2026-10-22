// spec 009 RF-1 — ninguna respuesta HTTP que devuelva un usuario expone password_hash.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { users } from '../../db/schema.js';
import { generateAccessToken } from '../../src/domain/token.js';
import { invitationTokens } from '../../src/infrastructure/db/repositories/index.js';

let api;
before(async () => { await setupDb(); api = await startApiServer(); });
after(async () => { await api.close(); await teardownDb(); });

const seedUser = (accountId, { role = 'owner', status = 'activo' } = {}) =>
  db.insert(users).values({
    account_id: accountId, name: role, email: `u-${crypto.randomUUID()}@test.com`, role, status, password_hash: '$2b$10$hashsecretohashsecretohashsecretohashsecretohashsecret',
  }).returning().then(r => r[0]);

const assertClean = (value, where) => {
  const text = JSON.stringify(value);
  assert.ok(!text.includes('password_hash'), `${where} expone password_hash`);
  assert.ok(!text.includes('hashsecreto'), `${where} expone el hash`);
};

test('las rutas que devuelven usuarios no exponen password_hash — RF-1', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const staff = await seedUser(account.id, { role: 'staff' });
    const otro = await seedUser(account.id, { role: 'staff' });
    const ownerTk = tokenFor(owner);
    const staffTk = tokenFor(staff);

    const calls = [
      ['GET', '/staff', undefined, ownerTk],
      ['GET', `/staff/${staff.id}`, undefined, ownerTk],
      ['PATCH', `/staff/${staff.id}`, { name: 'Nuevo' }, ownerTk],
      ['PATCH', '/me', { name: 'Yo' }, staffTk],
      ['POST', '/staff', { name: 'Pend', email: `p-${crypto.randomUUID()}@test.com` }, ownerTk],
      ['PATCH', `/staff/${otro.id}/deactivate`, undefined, ownerTk],
    ];
    for (const [method, path, body, tk] of calls) {
      const res = await api.call(method, path, body, tk);
      assert.ok(res.status < 300, `${method} ${path} → ${res.status} ${res.text}`);
      assertClean(res.body, `${method} ${path}`);
    }

    // reenvío de invitación sobre un pendiente
    const pend = await seedUser(account.id, { role: 'staff', status: 'pendiente' });
    const resend = await api.call('PATCH', `/staff/${pend.id}/resend-invitation`, undefined, ownerTk);
    assert.equal(resend.status, 200);
    assertClean(resend.body, 'resend-invitation');

    // activación
    const { token, hash } = generateAccessToken();
    await invitationTokens.create(db, { user_id: pend.id, token_hash: hash, expires_at: new Date(Date.now() + 3600000) });
    const act = await api.call('POST', '/public/staff-invitations/activate', { token, password: 'clave12345' });
    assert.equal(act.status, 200);
    assertClean(act.body, 'activate');
    assert.equal(act.body.user.status, 'activo');
    assert.equal(act.body.user.id, pend.id); // la vista conserva los campos útiles
  }));
