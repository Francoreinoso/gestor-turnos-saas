// spec 008 RF-14, RF-15, RF-10 — la configuración inválida impide arrancar y nunca imprime el secreto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig, ConfigError, EXAMPLE_SECRETS } from '../../src/infrastructure/config.js';

const GOOD = 'x'.repeat(40);
const dev = (extra = {}) => ({ NODE_ENV: 'development', JWT_SECRET: 'cualquiera', ...extra });
const prod = (extra = {}) => ({ NODE_ENV: 'production', JWT_SECRET: GOOD, ...extra });

const rejects = (env, variable) => {
  assert.throws(() => loadConfig(env), (err) => {
    assert.ok(err instanceof ConfigError, 'es un ConfigError');
    assert.match(err.message, new RegExp(variable), 'el mensaje nombra la variable');
    return true;
  }, JSON.stringify(env));
};

test('configuración mínima válida y valores por defecto', () => {
  const cfg = loadConfig({ JWT_SECRET: 'algo' });
  assert.deepEqual(cfg, { nodeEnv: 'development', port: 3000, trustProxy: 0, jwtSecret: 'algo' });
});

test('JWT_SECRET ausente, vacío o de solo espacios → no arranca — RF-14', () => {
  rejects({}, 'JWT_SECRET');
  rejects({ JWT_SECRET: '' }, 'JWT_SECRET');
  rejects({ JWT_SECRET: '   ' }, 'JWT_SECRET');
});

test('TRUST_PROXY: entero ≥ 0 — RF-10, RF-14', () => {
  assert.equal(loadConfig(dev({ TRUST_PROXY: '1' })).trustProxy, 1);
  assert.equal(loadConfig(dev({ TRUST_PROXY: '0' })).trustProxy, 0);
  assert.equal(loadConfig(dev({ TRUST_PROXY: '' })).trustProxy, 0, 'vacío = valor por defecto');
  for (const bad of ['uno', '-1', '1.5', '1e1', ' 2', 'true']) rejects(dev({ TRUST_PROXY: bad }), 'TRUST_PROXY');
});

test('PORT: entero entre 1 y 65535 si está definido — RF-14', () => {
  assert.equal(loadConfig(dev({ PORT: '8080' })).port, 8080);
  assert.equal(loadConfig(dev({ PORT: '65535' })).port, 65535);
  for (const bad of ['0', '70000', '-1', 'abc', '30.5', '65536']) rejects(dev({ PORT: bad }), 'PORT');
});

test('producción: secreto de al menos 32 caracteres', () => {
  assert.equal(loadConfig(prod()).jwtSecret, GOOD);
  rejects(prod({ JWT_SECRET: 'corto' }), 'JWT_SECRET');
  rejects(prod({ JWT_SECRET: 'x'.repeat(31) }), 'JWT_SECRET');
  assert.equal(loadConfig(prod({ JWT_SECRET: 'x'.repeat(32) })).jwtSecret.length, 32);
});

test('producción: los secretos de ejemplo del repositorio se rechazan; en desarrollo se aceptan — RF-14', () => {
  assert.ok(EXAMPLE_SECRETS.length >= 2);
  for (const example of EXAMPLE_SECRETS) {
    rejects(prod({ JWT_SECRET: example }), 'JWT_SECRET'); // cumple el largo mínimo: lo frena la lista de ejemplos
    assert.equal(loadConfig(dev({ JWT_SECRET: example })).jwtSecret, example);
  }
});

test('la lista de secretos de ejemplo coincide con los .env.example reales (no puede quedar desactualizada)', () => {
  for (const file of ['../../../.env.example', '../../.env.example']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const value = /^JWT_SECRET=(.*)$/m.exec(text)?.[1]?.trim();
    assert.ok(value && EXAMPLE_SECRETS.includes(value), `${file}: ${value} debe estar en EXAMPLE_SECRETS`);
  }
});

test('el mensaje de error nunca contiene el valor del secreto — RF-15', () => {
  const secret = 'S3CR3T0-que-no-debe-aparecer';
  for (const env of [prod({ JWT_SECRET: secret }), dev({ JWT_SECRET: secret, TRUST_PROXY: 'uno' }), dev({ JWT_SECRET: secret, PORT: '0' })]) {
    try { loadConfig(env); } catch (err) { assert.ok(!String(err.message).includes(secret), err.message); assert.ok(!String(err.stack).includes(secret)); }
  }
  for (const example of EXAMPLE_SECRETS) {
    try { loadConfig(prod({ JWT_SECRET: example })); assert.fail('debía lanzar'); } catch (err) { assert.ok(!String(err.message).includes(example), err.message); }
  }
});
