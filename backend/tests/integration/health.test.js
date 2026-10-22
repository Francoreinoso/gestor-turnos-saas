import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sql } from 'drizzle-orm';
import { setupDb, teardownDb, db } from '../helpers/db.js';
import { createHealthRouter } from '../../src/infrastructure/http/routes/health.js';

// spec 006 RF-15 / D-P5: /health consulta la base; el 503 se prueba con un ping inyectado.
before(setupDb);
after(teardownDb);

const serve = async (ping, timeoutMs) => {
  const app = express();
  app.use('/health', createHealthRouter({ ping, timeoutMs }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  const text = await res.text();
  await new Promise(resolve => server.close(resolve));
  return { status: res.status, text, body: JSON.parse(text) };
};

test('GET /health con la base viva → 200 { status: ok }, sin autenticación', async () => {
  const res = await serve(() => db.execute(sql`select 1`));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('GET /health con la base caída → 503 sin filtrar el motivo del error', async () => {
  const res = await serve(() => Promise.reject(new Error('connect ECONNREFUSED secreto-interno')));
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: 'unavailable' });
  assert.ok(!res.text.includes('ECONNREFUSED') && !res.text.includes('secreto-interno'));
});

test('GET /health con la base colgada → 503 tras el límite de tiempo', async () => {
  const res = await serve(() => new Promise(() => {}), 50);
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { status: 'unavailable' });
});
