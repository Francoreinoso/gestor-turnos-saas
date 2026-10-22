// spec 008 RF-10 — la IP del cliente sale de X-Forwarded-For solo si TRUST_PROXY lo indica.
// Archivo propio: los limitadores guardan su contador en memoria por proceso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, teardownDb } from '../helpers/db.js';
import { startApiServer } from '../helpers/apiServer.js';

let behindProxy; // trust proxy = 1 (nginx delante)
let direct; // trust proxy = 0 (acceso directo, X-Forwarded-For no es de fiar)
before(async () => {
  await setupDb();
  behindProxy = await startApiServer({ trustProxy: 1 });
  direct = await startApiServer({ trustProxy: 0 });
});
after(async () => { await behindProxy.close(); await direct.close(); await teardownDb(); });

const fail = (server, ip) => server.call('POST', '/auth/login', { email: 'nadie@test.com', password: 'clave-incorrecta' }, undefined, { ip });

test('TRUST_PROXY=1: cada IP de X-Forwarded-For tiene su propio cupo, sin advertencias de la librería — RF-10', async () => {
  const warnings = [];
  const original = console.error;
  console.error = (...args) => warnings.push(args);
  try {
    for (let i = 0; i < 10; i++) assert.equal((await fail(behindProxy, '203.0.113.10')).status, 401);
    assert.equal((await fail(behindProxy, '203.0.113.10')).status, 429, 'la IP 10 queda bloqueada');
    assert.equal((await fail(behindProxy, '203.0.113.11')).status, 401, 'otra IP del mismo proxy no se ve afectada');
  } finally {
    console.error = original;
  }
  assert.deepEqual(warnings.filter(w => /forwarded/i.test(String(w[0]?.message ?? w[0]))), [], 'express-rate-limit no debe advertir de un proxy mal configurado');
});

test('TRUST_PROXY=0: X-Forwarded-For se ignora y todos comparten el cupo de la IP del socket — RF-10', async () => {
  const original = console.error;
  console.error = () => {}; // la librería advierte (a propósito) que la cabecera llega con trust proxy desactivado
  try {
    for (let i = 0; i < 10; i++) assert.equal((await fail(direct, `198.51.100.${i + 1}`)).status, 401);
    // una IP "nueva" declarada por el cliente no le da un cupo nuevo
    assert.equal((await fail(direct, '198.51.100.200')).status, 429);
  } finally {
    console.error = original;
  }
});
