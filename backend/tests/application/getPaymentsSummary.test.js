import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentsSummary } from '../../src/application/getPaymentsSummary.js';

const makeRepos = (calls, o = {}) => ({
  payments: {
    summarize: async (db, args) => { calls.push(['summarize', args]); return { totalAmount: 0, employeeAmount: 0, businessAmount: 0, paymentCount: 0 }; },
    summarizeByEmployee: async (db, args) => { calls.push(['summarizeByEmployee', args]); return []; },
    ...o.payments,
  },
});

const db = {};
const now = new Date('2026-09-17T12:00:00Z');
const owner = { id: 'own-1', role: 'owner' };
const staff = { id: 'stf-1', role: 'staff' };

// T07 — validación de período y alcance por rol

test('período inválido → 400 antes de tocar cualquier repo', async () => {
  const calls = [];
  await assert.rejects(
    () => getPaymentsSummary(db, { accountId: 'acc-1', actor: owner, query: { period: 'este_anio' }, now }, makeRepos(calls)),
    { status: 400 },
  );
  assert.deepEqual(calls, []);
});

test('staff con employee_id de otro en la query → se ignora, resuelve a su propio id', async () => {
  const calls = [];
  await getPaymentsSummary(db, { accountId: 'acc-1', actor: staff, query: { employee_id: 'otro' }, now }, makeRepos(calls));
  assert.equal(calls[0][1].employeeId, 'stf-1');
});

test('owner sin employee_id → summarize se llama sin filtro de profesional', async () => {
  const calls = [];
  await getPaymentsSummary(db, { accountId: 'acc-1', actor: owner, query: {}, now }, makeRepos(calls));
  assert.equal(calls[0][1].employeeId, undefined);
});

// T08 — arma la respuesta

test('owner → llama summarize y summarizeByEmployee, y la respuesta trae byEmployee', async () => {
  const calls = [];
  const repos = makeRepos(calls, {
    payments: {
      summarize: async () => ({ totalAmount: 150, employeeAmount: 40, businessAmount: 60, paymentCount: 2 }),
      summarizeByEmployee: async () => { calls.push(['summarizeByEmployee']); return [{ employeeId: 'u1' }]; },
    },
  });
  const result = await getPaymentsSummary(db, { accountId: 'acc-1', actor: owner, query: {}, now }, repos);
  assert.deepEqual(calls.map(c => c[0]), ['summarizeByEmployee']);
  assert.equal(result.totalAmount, 150);
  assert.deepEqual(result.byEmployee, [{ employeeId: 'u1' }]);
});

test('staff → summarizeByEmployee NUNCA se llama, la respuesta no trae byEmployee', async () => {
  const calls = [];
  const repos = makeRepos(calls, {
    payments: {
      summarize: async () => ({ totalAmount: 40, employeeAmount: 40, businessAmount: 60, paymentCount: 1 }),
      summarizeByEmployee: async () => { calls.push(['summarizeByEmployee']); return []; },
    },
  });
  const result = await getPaymentsSummary(db, { accountId: 'acc-1', actor: staff, query: {}, now }, repos);
  assert.deepEqual(calls, []); // nunca invocado, no solo omitido del response
  assert.equal('byEmployee' in result, false);
});

// Cierre de huecos detectados en la auditoría RF-por-RF

test('RF-3: owner con employee_id válido → summarize y summarizeByEmployee reciben ese filtro', async () => {
  const calls = [];
  await getPaymentsSummary(db, { accountId: 'acc-1', actor: owner, query: { employee_id: 'u1' }, now }, makeRepos(calls));
  assert.equal(calls[0][1].employeeId, 'u1'); // summarize
  assert.equal(calls[1][1].employeeId, 'u1'); // summarizeByEmployee
});

test('RF-13: preset y rango libre juntos → 400 antes de tocar el repo (también a nivel de aplicación, no solo dominio)', async () => {
  const calls = [];
  await assert.rejects(
    () => getPaymentsSummary(db, { accountId: 'acc-1', actor: owner, query: { period: 'hoy', date_from: '2026-01-01T00:00:00Z' }, now }, makeRepos(calls)),
    { status: 400, message: 'ambiguous_period_filter' },
  );
  assert.deepEqual(calls, []);
});

test('RF-21: identidad y alcance salen de accountId/actor, nunca de campos inyectados en la query', async () => {
  const calls = [];
  // query intenta pisar cuenta/rol/identidad — no debe tener ningún efecto
  const hostileQuery = { account_id: 'acc-ajena', role: 'owner', actor: { role: 'owner' }, employee_id: undefined };
  await getPaymentsSummary(db, { accountId: 'acc-1', actor: staff, query: hostileQuery, now }, makeRepos(calls));
  assert.equal(calls[0][1].accountId, 'acc-1'); // el accountId real, no el de la query
  assert.equal(calls[0][1].employeeId, 'stf-1'); // el staff sigue forzado a sí mismo, la query no lo vuelve owner
});

test('RF-22: nunca invoca ningún método de escritura del repo (create/update/delete no existen en el fake y no hace falta)', async () => {
  // Los fakes de este archivo NUNCA exponen create/update/delete — si getPaymentsSummary
  // intentara escribir algo, fallaría con "not a function". Que las demás pruebas pasen
  // ya lo demuestra; este test lo deja explícito para que una regresión futura no lo oculte.
  const readOnlyRepos = { payments: { summarize: async () => ({ totalAmount: 0, employeeAmount: 0, businessAmount: 0, paymentCount: 0 }), summarizeByEmployee: async () => [] } };
  assert.doesNotThrow(() => Object.keys(readOnlyRepos.payments).forEach((k) => {
    if (['create', 'update', 'delete', 'deleteByAppointment'].includes(k)) throw new Error('repo de escritura inesperado');
  }));
  await assert.doesNotReject(() => getPaymentsSummary(db, { accountId: 'acc-1', actor: owner, query: {}, now }, readOnlyRepos));
});
