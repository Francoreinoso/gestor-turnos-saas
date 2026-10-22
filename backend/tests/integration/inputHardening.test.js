// spec 007 T02, T18 — huecos de validación (RF-9, RF-10, RF-11, RF-13): nunca 500 y nunca un valor incorrecto persistido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { users, services, clients } from '../../db/schema.js';

let api;
before(async () => { await setupDb(); api = await startApiServer(); });
after(async () => { await api.close(); await teardownDb(); });

const seedUser = (accountId, { role = 'owner', status = 'activo' } = {}) =>
  db.insert(users).values({
    account_id: accountId, name: role, email: `u-${crypto.randomUUID()}@test.com`, role, status, password_hash: 'x',
  }).returning().then(r => r[0]);

const FUTURE = () => new Date(Date.now() + 5 * 86400000).toISOString();
const ok4xx = (res, msg) => {
  assert.ok(res.status >= 400 && res.status < 500, `${msg} → ${res.status}`);
  assert.equal(typeof res.body?.error, 'string', msg);
};

test('register con tipos incorrectos → 400, no 500 — RF-9', async () => {
  for (const body of [{ name: 123 }, { business_name: 'B', name: 'A', email: {}, password: 'x' }, { business_name: 'B', name: 'A', email: 'a@b.com', password: ['a'] }]) {
    const res = await api.call('POST', '/auth/register', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const ok = await api.call('POST', '/auth/register', { business_name: 'B', name: 'A', email: `R-${crypto.randomUUID()}@Test.com`, password: 'clave' });
  assert.equal(ok.status, 201);
});

test('cuerpo [] / ausente → 400 invalid_body en cada POST y PATCH — RF-10', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const tk = tokenFor(owner);
    const staff = await seedUser(account.id, { role: 'staff' });
    const [svc] = await db.insert(services).values({ account_id: account.id, name: 'S', duration_minutes: 30, price: '10.00' }).returning();
    const [cli] = await db.insert(clients).values({ account_id: account.id, name: 'C', email: 'c@t.com' }).returning();

    const targets = [
      ['POST', '/auth/register'], ['POST', '/auth/login'], ['POST', '/appointments'], ['POST', '/appointments/block'],
      ['POST', '/services'], ['PATCH', `/services/${svc.id}`], ['PATCH', `/services/${svc.id}/prices`],
      ['POST', '/clients'], ['PATCH', `/clients/${cli.id}`], ['PATCH', '/accounts/commission'],
      ['PATCH', '/me'], ['POST', '/staff'], ['PATCH', `/staff/${staff.id}`], ['PUT', `/staff/${staff.id}/availability`],
      ['POST', '/public/bookings'], ['POST', '/public/staff-invitations/activate'],
    ];
    for (const [method, path] of targets) {
      for (const body of [[], undefined]) { // express.json (strict) rechaza null y strings antes de llegar a Zod
        if (path.endsWith('/availability') && Array.isArray(body)) continue; // [] es el horario vacío válido
        const res = await api.call(method, path, body, tk);
        assert.deepEqual([res.status, res.body], [400, { error: 'invalid_body' }], `${method} ${path} ${JSON.stringify(body)}`);
      }
    }
  }));

test('tipos incorrectos en services, clients y public bookings → 4xx — RF-9', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const tk = tokenFor(owner);
    const [svc] = await db.insert(services).values({ account_id: account.id, name: 'S', duration_minutes: 30, price: '10.00' }).returning();

    const cases = [
      ['POST', '/services', { name: 'X', duration_minutes: 30, price: 'abc' }],
      ['POST', '/services', { name: 'X', duration_minutes: 1.5, price: 10 }],
      ['POST', '/services', { name: 5, duration_minutes: 30, price: 10 }],
      ['POST', '/clients', { name: 'A', email: 'a@b.com', notes: 5 }],
      ['POST', '/clients', { name: ['A'], email: 'a@b.com' }],
      ['POST', '/public/bookings', { account_id: account.id, service_id: svc.id, scheduled_at: [], client: { name: 'A', email: 'a@b.com' } }],
      ['POST', '/public/bookings', { account_id: account.id, service_id: svc.id, scheduled_at: FUTURE(), client: 'x' }],
      ['POST', '/public/bookings', { account_id: 'no-uuid', service_id: svc.id, scheduled_at: FUTURE(), client_id: svc.id }],
    ];
    for (const [method, path, body] of cases) ok4xx(await api.call(method, path, body, tk), `${method} ${path} ${JSON.stringify(body)}`);
    assert.deepEqual(await db.select().from(clients).where(eq(clients.account_id, account.id)), []);
  }));

test('campos desconocidos se ignoran y los opcionales ausentes siguen ausentes — RF-11, RF-13', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const tk = tokenFor(owner);

    const res = await api.call('POST', '/clients', { name: ' Ana ', email: 'ANA@T.com', foo: 1 }, tk);
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Ana'); // RF-12: recortado
    assert.equal(res.body.email, 'ana@t.com');
    assert.equal(res.body.notes ?? null, null); // RF-13: ausente no se convierte en ''
    assert.equal(res.body.foo, undefined);
  }));

test('un client anidado no puede pisar account_id — D-P5', () =>
  withAccount(async (account) => {
    await withAccount(async (otra) => {
      const owner = await seedUser(account.id);
      const pro = await seedUser(account.id, { role: 'staff' });
      const [svc] = await db.insert(services).values({ account_id: account.id, name: 'S', duration_minutes: 30, price: '10.00' }).returning();
      const client = { name: 'Eve', email: `eve-${crypto.randomUUID()}@t.com`, account_id: otra.id };

      const panel = await api.call('POST', '/appointments', { service_id: svc.id, scheduled_at: FUTURE(), client, employee_id: pro.id }, tokenFor(owner));
      assert.equal(panel.status, 201);
      const publico = await api.call('POST', '/public/bookings', {
        account_id: account.id, service_id: svc.id, scheduled_at: new Date(Date.now() + 9 * 86400000).toISOString(),
        client: { ...client, email: `eve2-${crypto.randomUUID()}@t.com` }, employee_id: pro.id,
      });
      assert.equal(publico.status, 201);

      assert.deepEqual(await db.select().from(clients).where(eq(clients.account_id, otra.id)), []);
      assert.equal((await db.select().from(clients).where(eq(clients.account_id, account.id))).length, 2);
    });
  }));

test('GET /availability con fecha ilegible → 400 invalid_date — D-P6', () =>
  withAccount(async (account) => {
    const res = await api.call('GET', `/availability/${account.id}?date_from=x&date_to=y&service_id=${crypto.randomUUID()}`);
    assert.deepEqual([res.status, res.body], [400, { error: 'invalid_date' }]);
  }));
