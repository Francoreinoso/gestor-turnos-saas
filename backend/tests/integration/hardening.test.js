// spec 008 — endurecimiento de la API: ids inválidos, errores seguros, límites, contraseñas y cabeceras.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startApiServer, tokenFor } from '../helpers/apiServer.js';
import { ROUTES } from '../../src/infrastructure/http/createApp.js';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema.js';

let api;
before(async () => { await setupDb(); api = await startApiServer(); });
after(async () => { await api.close(); await teardownDb(); });

const seedUser = (accountId, { role = 'owner', status = 'activo' } = {}) =>
  db.insert(users).values({
    account_id: accountId, name: role, email: `h-${crypto.randomUUID()}@test.com`, role, status, password_hash: 'x',
  }).returning().then(r => r[0]);

const LEAK = /select\s|failed query|password_hash|"users"|"appointments"/i;

// T03 — RF-5, RF-7: ninguna ruta con parámetro de id responde 500 ante un valor no UUID.
// Recorre las rutas REALES (tabla ROUTES de createApp): una ruta nueva sin guarda hace fallar este test.
test('toda ruta con parámetro de id rechaza un valor no UUID sin tocar la base — RF-5, RF-7', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const token = tokenFor(owner);

    const targets = [];
    for (const [mount, router] of ROUTES) {
      for (const layer of router.stack) {
        if (!layer.route || !layer.route.path.includes(':')) continue;
        for (const method of Object.keys(layer.route.methods)) {
          targets.push({ method: method.toUpperCase(), mount, path: layer.route.path });
        }
      }
    }
    assert.ok(targets.length >= 20, `el recorrido debe cubrir las rutas con parámetros (cubrió ${targets.length})`);

    for (const { method, mount, path } of targets) {
      const url = mount + path.replace(/:[A-Za-z_]+/g, 'abc');
      // Las rutas públicas con token responden 401 (spec 005 RF-7); /public/accounts/:id responde 404 en su caso de uso.
      const expected = mount === '/public' && !path.startsWith('/accounts') ? 401 : 404;
      const withBody = method !== 'GET' && method !== 'HEAD';
      const res = await api.call(method, url, withBody ? {} : undefined, token);
      assert.equal(res.status, expected, `${method} ${url} → ${res.status} ${res.text}`);
      assert.ok(!LEAK.test(res.text), `${method} ${url} filtra detalles internos: ${res.text}`);
    }
  }));

test('GET /availability/abc sin token → 404, nunca SQL — RF-5', async () => {
  const res = await api.call('GET', '/availability/abc?service_id=abc&date_from=2030-01-01&date_to=2030-01-02');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'service_not_found' });
  assert.ok(!LEAK.test(res.text));
});

// T04 — RF-6: filtros UUID inválidos
test('filtros UUID inválidos: 400 en turnos y slots, "inexistente" en pagos — RF-6', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const token = tokenFor(owner);

    const appts = await api.call('GET', '/appointments?employee_id=abc', undefined, token);
    assert.deepEqual([appts.status, appts.body], [400, { error: 'invalid_body' }]);

    const payments = await api.call('GET', '/payments?employee_id=abc', undefined, token);
    assert.deepEqual([payments.status, payments.body], [200, { payments: [], hasMore: false }]);

    const summary = await api.call('GET', '/payments/summary?employee_id=abc', undefined, token);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.paymentCount, 0);
    assert.deepEqual(summary.body.byEmployee, []);

    const slots = await api.call('GET', `/availability/${account.id}?service_id=abc&date_from=2030-01-01&date_to=2030-01-02`);
    assert.deepEqual([slots.status, slots.body], [400, { error: 'invalid_body' }]);
    const slots2 = await api.call('GET', `/availability/${account.id}?service_id=${crypto.randomUUID()}&employee_id=abc&date_from=2030-01-01&date_to=2030-01-02`);
    assert.deepEqual([slots2.status, slots2.body], [400, { error: 'invalid_body' }]);
  }));

// T06 — RF-1, RF-2, RF-3: el manejador de errores de punta a punta
test('un error inesperado real de Postgres responde exactamente internal_error y se registra sin la query — RF-1, RF-2', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args);
    try {
      // 300 caracteres exceden varchar(255): Postgres lanza 22001 con el texto de la consulta.
      const res = await api.call('POST', '/clients?token=SECRETO-EN-QUERY', { name: 'x'.repeat(300), email: 'a@b.com' }, tokenFor(owner));
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: 'internal_error' });
      assert.ok(!LEAK.test(res.text) && !/varying|too long/i.test(res.text), res.text);
    } finally {
      console.error = original;
    }
    assert.equal(logged.length, 1);
    const line = String(logged[0][0]);
    assert.match(line, /POST \/clients/);
    assert.ok(!line.includes('SECRETO-EN-QUERY'), 'la query string no debe registrarse');
    assert.ok(logged[0][1] instanceof Error, 'la traza queda en el servidor');
  }));

test('errores del parser se traducen a un código fijo, nunca al mensaje de la librería — RF-3', async () => {
  const json = { 'content-type': 'application/json' };

  const broken = await api.call('POST', '/auth/login', undefined, undefined, { headers: json, raw: '{"a":' });
  assert.deepEqual([broken.status, broken.body], [400, { error: 'invalid_body' }]);

  const big = await api.call('POST', '/auth/login', undefined, undefined, { headers: json, raw: JSON.stringify({ a: 'x'.repeat(200_000) }) });
  assert.deepEqual([big.status, big.body], [413, { error: 'payload_too_large' }]);

  const charset = await api.call('POST', '/auth/login', undefined, undefined, { headers: { 'content-type': 'application/json; charset=latin1' }, raw: '{}' });
  assert.deepEqual([charset.status, charset.body], [415, { error: 'unsupported_media_type' }]);

  // text/plain: el parser JSON lo ignora, no hay cuerpo y el endpoint responde por cuerpo ausente
  const plain = await api.call('POST', '/auth/login', undefined, undefined, { headers: { 'content-type': 'text/plain' }, raw: 'hola' });
  assert.deepEqual([plain.status, plain.body], [400, { error: 'invalid_body' }]);

  for (const res of [broken, big, charset, plain]) assert.ok(!/Unexpected|entity|charset|JSON/i.test(res.text), res.text);
});

// T08 — RF-11: la política de contraseña en los tres puntos de entrada
test('contraseña: registro, cambio propio y activación aplican la política; el login no — RF-11', () =>
  withAccount(async (account) => {
    const email = () => `p-${crypto.randomUUID()}@test.com`;
    const reg = (password) => api.call('POST', '/auth/register', { business_name: 'B', name: 'A', email: email(), password });

    const short = await reg('1234567');
    assert.deepEqual([short.status, short.body], [400, { error: 'invalid_password' }]);
    const ok = await reg('12345678');
    assert.equal(ok.status, 201);

    // cambio propio
    const staff = await seedUser(account.id, { role: 'staff' });
    const me = (password) => api.call('PATCH', '/me', { password }, tokenFor(staff));
    assert.deepEqual([(await me('abc')).status, (await me('abc')).body], [400, { error: 'invalid_password' }]);
    assert.equal((await me('nueva-clave-1')).status, 200);

    // activación de trabajador: la política se evalúa antes de consultar el token
    const act = await api.call('POST', '/public/staff-invitations/activate', { token: 'cualquiera', password: 'corta' });
    assert.deepEqual([act.status, act.body], [400, { error: 'invalid_password' }]);

    // el login no aplica la regla: un usuario existente con una contraseña corta sigue entrando
    const legacy = await seedUser(account.id);
    const legacyEmail = email();
    await db.update(users).set({ email: legacyEmail, password_hash: await bcrypt.hash('abc', 4) }).where(eq(users.id, legacy.id));
    const login = await api.call('POST', '/auth/login', { email: legacyEmail, password: 'abc' });
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.token, 'string');
  }));

// T10 — RF-13: un token con alg none o firmado con otro algoritmo no autentica
test('el middleware de auth rechaza un token alg none y uno HS512 — RF-13', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = { id: owner.id, account_id: account.id, role: 'owner' };
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
    const hs512 = jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS512' });

    for (const bad of [none, hs512]) {
      const res = await api.call('GET', '/appointments', undefined, bad);
      assert.deepEqual([res.status, res.body], [401, { error: 'unauthorized' }]);
    }
    assert.equal((await api.call('GET', '/appointments', undefined, tokenFor(owner))).status, 200);
  }));

// T11 — RF-8, RF-9: límites de intentos de auth
const attempt = (ip, email, password = 'clave-incorrecta') =>
  api.call('POST', '/auth/login', { email, password }, undefined, { ip });
const freshIp = () => `172.${16 + Math.floor(Math.random() * 15)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

test('login: el 11.º intento fallido de una IP es 429 con Retry-After; los exitosos no cuentan — RF-8', () =>
  withAccount(async (account) => {
    const user = await seedUser(account.id);
    const email = `l-${crypto.randomUUID()}@test.com`;
    await db.update(users).set({ email, password_hash: await bcrypt.hash('clave-correcta', 4) }).where(eq(users.id, user.id));
    const ip = freshIp();

    for (let i = 0; i < 12; i++) assert.equal((await attempt(ip, email, 'clave-correcta')).status, 200, `éxito #${i + 1} no debe contar`);
    for (let i = 1; i <= 10; i++) assert.equal((await attempt(ip, email)).status, 401, `fallo #${i}`);

    const blocked = await attempt(ip, email);
    assert.deepEqual([blocked.status, blocked.body], [429, { error: 'too_many_requests' }]);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After presente');
    // Alcanzado el tope, el bloqueo vale aunque la clave sea correcta (comportamiento esperado del bloqueo por IP).
    assert.equal((await attempt(ip, email, 'clave-correcta')).status, 429);
  }));

test('login: otra IP no se ve afectada por el bloqueo — RF-8', async () => {
  const blockedIp = freshIp();
  for (let i = 0; i < 10; i++) await attempt(blockedIp, 'nadie@test.com');
  assert.equal((await attempt(blockedIp, 'nadie@test.com')).status, 429);
  assert.equal((await attempt(freshIp(), 'nadie@test.com')).status, 401);
});

test('login: una solicitud con cuerpo inválido también cuenta como intento fallido — RF-8', async () => {
  const ip = freshIp();
  for (let i = 0; i < 10; i++) assert.equal((await api.call('POST', '/auth/login', {}, undefined, { ip })).status, 400);
  assert.equal((await api.call('POST', '/auth/login', {}, undefined, { ip })).status, 429);
});

test('registro: la 6.ª solicitud de una IP en una hora es 429 — RF-9', async () => {
  const ip = freshIp();
  const reg = () => api.call('POST', '/auth/register', {
    business_name: 'B', name: 'A', email: `r-${crypto.randomUUID()}@test.com`, password: 'clave-segura-1',
  }, undefined, { ip });
  for (let i = 1; i <= 5; i++) assert.equal((await reg()).status, 201, `registro #${i}`);
  const blocked = await reg();
  assert.deepEqual([blocked.status, blocked.body], [429, { error: 'too_many_requests' }]);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal((await api.call('POST', '/auth/register', {
    business_name: 'B', name: 'A', email: `r-${crypto.randomUUID()}@test.com`, password: 'clave-segura-1',
  }, undefined, { ip: freshIp() })).status, 201);
});

// T15 — RF-16: cabeceras de la API
const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
const assertHeaders = (res, label) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value, `${label}: ${name}`);
  assert.equal(res.headers.get('x-powered-by'), null, `${label}: x-powered-by no debe enviarse`);
};

test('todas las respuestas de la API llevan las cabeceras de seguridad y no X-Powered-By — RF-16', () =>
  withAccount(async (account) => {
    const owner = await seedUser(account.id);
    const token = tokenFor(owner);
    const original = console.error;
    console.error = () => {};
    try {
      assertHeaders(await api.call('GET', '/health'), '/health 200');
      assertHeaders(await api.call('GET', '/appointments', undefined, token), '200 autenticada');
      assertHeaders(await api.call('GET', '/appointments'), '401');
      assertHeaders(await api.call('GET', '/appointments/abc', undefined, token), '404');
      assertHeaders(await api.call('GET', '/no-existe'), '404 sin ruta (Express)');
      assertHeaders(await api.call('POST', '/auth/login', undefined, undefined, { headers: { 'content-type': 'application/json' }, raw: '{"a":' }), '400 del parser');
      assertHeaders(await api.call('POST', '/clients', { name: 'x'.repeat(300), email: 'a@b.com' }, token), '500');
    } finally {
      console.error = original;
    }
    // el bloqueo por límite también es una respuesta de la API
    const ip = '192.0.2.77';
    for (let i = 0; i < 10; i++) await api.call('POST', '/auth/login', {}, undefined, { ip });
    const limited = await api.call('POST', '/auth/login', {}, undefined, { ip });
    assert.equal(limited.status, 429);
    assertHeaders(limited, '429');
  }));
