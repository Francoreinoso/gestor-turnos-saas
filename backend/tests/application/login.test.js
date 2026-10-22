// spec 008 RF-12 — el login ejecuta SIEMPRE una comparación bcrypt completa, para que el tiempo de respuesta
// no distinga un email inexistente de uno existente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, DUMMY_HASH } from '../../src/application/login.js';

const REAL_HASH = '$2b$10$realhashrealhashrealhashrealhashrealhashrealhashrea';
const DUMMY = '$2b$10$dummydummydummydummydummydummydummydummydummydummydum';

const run = async (user, { password = 'clave-1234', verdict = false } = {}) => {
  const calls = [];
  const compare = async (plain, hash) => { calls.push({ plain, hash }); return verdict; };
  const repos = { users: { findByEmail: async () => user } };
  let result, error;
  try { result = await login({}, { email: 'a@b.com', password }, repos, { compare, dummyHash: DUMMY }); } catch (e) { error = e; }
  return { calls, result, error };
};

const invalid = (error) => {
  assert.equal(error?.status, 401);
  assert.equal(error?.message, 'invalid_credentials');
};

test('email inexistente → 401 y compara contra el hash ficticio', async () => {
  const { calls, error } = await run(undefined);
  invalid(error);
  assert.deepEqual(calls, [{ plain: 'clave-1234', hash: DUMMY }]);
});

test('usuario pendiente → 401, misma comparación ficticia (no filtra el estado)', async () => {
  const { calls, error } = await run({ id: 'u', status: 'pendiente', password_hash: null });
  invalid(error);
  assert.deepEqual(calls.map(c => c.hash), [DUMMY]);
});

test('usuario inactivo con hash real → 401 sin usar su hash, misma comparación ficticia', async () => {
  const { calls, error } = await run({ id: 'u', status: 'inactivo', password_hash: REAL_HASH }, { verdict: true });
  invalid(error); // aunque la comparación "diera true", un inactivo nunca entra
  assert.deepEqual(calls.map(c => c.hash), [DUMMY]);
});

test('activo pero sin contraseña definida → 401, comparación ficticia', async () => {
  const { calls, error } = await run({ id: 'u', status: 'activo', password_hash: null });
  invalid(error);
  assert.deepEqual(calls.map(c => c.hash), [DUMMY]);
});

test('activo con clave incorrecta → 401 comparando contra su hash real (una sola comparación)', async () => {
  const { calls, error } = await run({ id: 'u', status: 'activo', password_hash: REAL_HASH }, { verdict: false });
  invalid(error);
  assert.deepEqual(calls.map(c => c.hash), [REAL_HASH]);
});

test('activo con clave correcta → devuelve el usuario', async () => {
  const user = { id: 'u', status: 'activo', password_hash: REAL_HASH };
  const { calls, result, error } = await run(user, { verdict: true });
  assert.equal(error, undefined);
  assert.equal(result, user);
  assert.equal(calls.length, 1);
});

test('en las cinco ramas hay exactamente una comparación', async () => {
  for (const user of [undefined, { status: 'pendiente' }, { status: 'inactivo', password_hash: REAL_HASH }, { status: 'activo' }, { status: 'activo', password_hash: REAL_HASH }]) {
    const { calls } = await run(user);
    assert.equal(calls.length, 1, JSON.stringify(user));
  }
});

test('el hash ficticio es un bcrypt válido con el mismo costo (10) que los reales — D7', () => {
  assert.match(DUMMY_HASH, /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
});
