import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPayments } from '../../src/application/listPayments.js';

const LIST_LIMIT = 500;

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

const makeRepos = (calls, rows) => ({
  payments: {
    findForList: async (db, args) => { calls.push(args); return rows; },
  },
});

const db = {};
const now = new Date('2026-09-17T12:00:00Z');
const owner = { id: 'own-1', role: 'owner' };
const staff = { id: 'stf-1', role: 'staff' };

// T09 — RF-8, RF-9, RF-10

test('pide limit + 1 al repo', async () => {
  const calls = [];
  await listPayments(db, { accountId: 'acc-1', actor: owner, query: {}, now }, makeRepos(calls, []));
  assert.equal(calls[0].limit, LIST_LIMIT + 1);
});

test('staff fuerza employeeId a su propio id, ignorando el filtro de la query', async () => {
  const calls = [];
  await listPayments(db, { accountId: 'acc-1', actor: staff, query: { employee_id: 'otro' }, now }, makeRepos(calls, []));
  assert.equal(calls[0].employeeId, 'stf-1');
});

test('repo devuelve limit + 1 filas → corta a limit y hasMore: true', async () => {
  const result = await listPayments(db, { accountId: 'acc-1', actor: owner, query: {}, now }, makeRepos([], makeRows(LIST_LIMIT + 1)));
  assert.equal(result.payments.length, LIST_LIMIT);
  assert.equal(result.hasMore, true);
});

test('repo devuelve menos que limit + 1 → hasMore: false, sin cortar', async () => {
  const result = await listPayments(db, { accountId: 'acc-1', actor: owner, query: {}, now }, makeRepos([], makeRows(3)));
  assert.equal(result.payments.length, 3);
  assert.equal(result.hasMore, false);
});

test('período inválido → 400 antes de tocar el repo', async () => {
  const calls = [];
  await assert.rejects(
    () => listPayments(db, { accountId: 'acc-1', actor: owner, query: { period: 'nope' }, now }, makeRepos(calls, [])),
    { status: 400 },
  );
  assert.deepEqual(calls, []);
});

// Cierre de huecos detectados en la auditoría RF-por-RF

test('RF-4: owner con employee_id ajeno/inexistente → el repo se llama con ese filtro (el vacío lo resuelve la query real, no listPayments)', async () => {
  const calls = [];
  const result = await listPayments(db, { accountId: 'acc-1', actor: owner, query: { employee_id: 'no-existe' }, now }, makeRepos(calls, []));
  assert.equal(calls[0].employeeId, 'no-existe');
  assert.deepEqual(result, { payments: [], hasMore: false });
});

test('RF-13: preset y rango libre juntos → 400 antes de tocar el repo', async () => {
  const calls = [];
  await assert.rejects(
    () => listPayments(db, { accountId: 'acc-1', actor: owner, query: { period: 'hoy', date_from: '2026-01-01T00:00:00Z' }, now }, makeRepos(calls, [])),
    { status: 400, message: 'ambiguous_period_filter' },
  );
  assert.deepEqual(calls, []);
});

test('RF-21: identidad y alcance salen de accountId/actor, nunca de campos inyectados en la query', async () => {
  const calls = [];
  const hostileQuery = { account_id: 'acc-ajena', role: 'owner', employee_id: 'otro' };
  await listPayments(db, { accountId: 'acc-1', actor: staff, query: hostileQuery, now }, makeRepos(calls, []));
  assert.equal(calls[0].accountId, 'acc-1');
  assert.equal(calls[0].employeeId, 'stf-1'); // sigue forzado, la query no lo vuelve owner
});

test('RF-22: nunca invoca ningún método de escritura del repo', async () => {
  const readOnlyRepos = { payments: { findForList: async () => [] } };
  await assert.doesNotReject(() => listPayments(db, { accountId: 'acc-1', actor: owner, query: {}, now }, readOnlyRepos));
});
