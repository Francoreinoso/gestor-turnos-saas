// spec 009 RF-21, RF-1 — el enlace de activación llega al owner y lleva al trabajador hasta una sesión.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { users } from '../../db/schema.js';

let api;
before(async () => { await setupDb(); api = await startApiServer(); });
after(async () => { await api.close(); await teardownDb(); });

const seedUser = (accountId, role) =>
  db.insert(users).values({
    account_id: accountId, name: role, email: `u-${crypto.randomUUID()}@test.com`, role, status: 'activo',
  }).returning().then(r => r[0]);

const tokenOf = (link) => new URL(link).searchParams.get('token');
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';

test('POST /staff devuelve invitation_link y ese token activa la cuenta de punta a punta', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id, 'owner');
    const email = `n-${crypto.randomUUID()}@test.com`;

    const res = await api.call('POST', '/staff', { name: 'Nueva', email }, tokenFor(owner));
    assert.equal(res.status, 201);
    assert.equal(res.body.action, 'create');
    assert.ok(res.body.invitation_link.startsWith(`${appUrl().replace(/\/+$/, '')}/activar?token=`));
    assert.ok(!JSON.stringify(res.body.user).includes('invitation_link'));

    const token = tokenOf(res.body.invitation_link);
    const act = await api.call('POST', '/public/staff-invitations/activate', { token, password: 'clave12345' });
    assert.equal(act.status, 200);
    assert.ok(!act.text.includes('password_hash'));
    assert.equal(act.body.user.email, email);

    const login = await api.call('POST', '/auth/login', { email, password: 'clave12345' });
    assert.equal(login.status, 200);
  }));

test('reenviar invalida el enlace anterior (410) y devuelve uno nuevo que funciona', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id, 'owner');
    const ownerTk = tokenFor(owner);
    const created = await api.call('POST', '/staff', { name: 'Nueva', email: `n-${crypto.randomUUID()}@test.com` }, ownerTk);
    const first = tokenOf(created.body.invitation_link);

    const resend = await api.call('PATCH', `/staff/${created.body.user.id}/resend-invitation`, undefined, ownerTk);
    assert.equal(resend.status, 200);
    const second = tokenOf(resend.body.invitation_link);
    assert.notEqual(second, first);

    const old = await api.call('POST', '/public/staff-invitations/activate', { token: first, password: 'clave12345' });
    assert.equal(old.status, 410);
    const fresh = await api.call('POST', '/public/staff-invitations/activate', { token: second, password: 'clave12345' });
    assert.equal(fresh.status, 200);
  }));

test('ningún otro endpoint de /staff incluye invitation_link', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id, 'owner');
    const staff = await seedUser(account.id, 'staff');
    const ownerTk = tokenFor(owner);
    const created = await api.call('POST', '/staff', { name: 'Nueva', email: `n-${crypto.randomUUID()}@test.com` }, ownerTk);
    const id = created.body.user.id;

    for (const [method, path, body] of [
      ['GET', '/staff'], ['GET', `/staff/${id}`], ['PATCH', `/staff/${id}`, { name: 'Otra' }],
      ['GET', `/staff/${id}/availability`], ['PATCH', `/staff/${id}/deactivate`],
    ]) {
      const res = await api.call(method, path, body, ownerTk);
      assert.ok(res.status < 300, `${method} ${path} → ${res.status}`);
      assert.ok(!res.text.includes('invitation_link'), `${method} ${path} expone invitation_link`);
    }
    const me = await api.call('PATCH', '/me', { name: 'Yo' }, tokenFor(staff));
    assert.ok(!me.text.includes('invitation_link'));
  }));

test('un staff que invita o reenvía recibe 403 sin enlace', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id, 'owner');
    const staff = await seedUser(account.id, 'staff');
    const created = await api.call('POST', '/staff', { name: 'Nueva', email: `n-${crypto.randomUUID()}@test.com` }, tokenFor(owner));
    const staffTk = tokenFor(staff);

    const invite = await api.call('POST', '/staff', { name: 'X', email: `x-${crypto.randomUUID()}@test.com` }, staffTk);
    assert.equal(invite.status, 403);
    assert.ok(!invite.text.includes('invitation_link'));
    const resend = await api.call('PATCH', `/staff/${created.body.user.id}/resend-invitation`, undefined, staffTk);
    assert.equal(resend.status, 403);
    assert.ok(!resend.text.includes('invitation_link'));
  }));
