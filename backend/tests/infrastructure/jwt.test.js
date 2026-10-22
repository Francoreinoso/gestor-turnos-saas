// spec 008 RF-13 — JWT firmado y verificado con HS256 fijado explícitamente.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../../src/infrastructure/http/jwt.js';

before(() => { process.env.JWT_SECRET = 'secreto-de-prueba-del-test'; });

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const payload = { id: 'u1', account_id: 'a1', role: 'owner' };

test('un token propio se verifica y conserva el payload', () => {
  const decoded = verifyToken(signToken(payload));
  assert.equal(decoded.id, 'u1');
  assert.equal(decoded.role, 'owner');
  assert.ok(decoded.exp - decoded.iat === 7 * 24 * 3600, 'expira a los 7 días');
});

test('el token se firma con HS256', () => {
  const header = JSON.parse(Buffer.from(signToken(payload).split('.')[0], 'base64url').toString());
  assert.equal(header.alg, 'HS256');
});

test('alg none (sin firma) se rechaza', () => {
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
  assert.throws(() => verifyToken(none));
  const noneWithSig = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.abc`;
  assert.throws(() => verifyToken(noneWithSig));
});

test('un token firmado con otro secreto se rechaza', () => {
  assert.throws(() => verifyToken(jwt.sign(payload, 'otro-secreto', { algorithm: 'HS256' })));
});

test('un algoritmo distinto de HS256 (aunque el secreto coincida) se rechaza', () => {
  assert.throws(() => verifyToken(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS512' })));
  assert.throws(() => verifyToken(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS384' })));
});

test('un token manipulado o vencido se rechaza', () => {
  const [h, , s] = signToken(payload).split('.');
  assert.throws(() => verifyToken(`${h}.${b64({ ...payload, role: 'owner', id: 'otro' })}.${s}`));
  assert.throws(() => verifyToken(jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -10 })));
  assert.throws(() => verifyToken('no-es-un-jwt'));
});
