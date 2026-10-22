// spec 008 RF-6 — filtros UUID inválidos: 400 en general, "inexistente" en pagos (spec 003 RF-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../../src/domain/validation.js';
import { slotsQuery } from '../../src/domain/schemas/availability.js';
import { uuidOrNil, NIL_UUID, isUuid } from '../../src/domain/uuid.js';
import { listPayments } from '../../src/application/listPayments.js';
import { getPaymentsSummary } from '../../src/application/getPaymentsSummary.js';

const U = '123e4567-e89b-12d3-a456-426614174000';
const dates = { date_from: '2030-01-01', date_to: '2030-01-02' };
const fails = (data, message) => assert.throws(() => parseInput(slotsQuery, data), { message, status: 400 }, JSON.stringify(data));

test('slotsQuery: service_id o employee_id que no son UUID → 400 invalid_body', () => {
  fails({ ...dates, service_id: 'abc' }, 'invalid_body');
  fails({ ...dates, service_id: U, employee_id: 'abc' }, 'invalid_body');
  fails({ ...dates, service_id: 123 }, 'invalid_body');
});

test('slotsQuery: ausente sigue siendo missing_fields y el UUID válido pasa', () => {
  fails({ ...dates }, 'missing_fields');
  fails({ ...dates, service_id: '' }, 'missing_fields');
  assert.equal(parseInput(slotsQuery, { ...dates, service_id: U, employee_id: U }).employee_id, U);
  assert.equal(parseInput(slotsQuery, { ...dates, service_id: U }).employee_id, undefined);
});

test('uuidOrNil: UUID válido y undefined se conservan; el resto se vuelve el UUID nulo (inexistente)', () => {
  assert.equal(uuidOrNil(U), U);
  assert.equal(uuidOrNil(undefined), undefined);
  for (const bad of ['abc', '', ' ', "1' or '1'='1", 5, {}]) assert.equal(uuidOrNil(bad), NIL_UUID, String(bad));
  assert.ok(isUuid(NIL_UUID));
});

const db = {};
const now = new Date('2026-09-17T12:00:00Z');
const owner = { id: 'own-1', role: 'owner' };

test('listPayments: employee_id no UUID se consulta como inexistente, no como texto', async () => {
  const calls = [];
  const repos = { payments: { findForList: async (d, args) => { calls.push(args); return []; } } };
  const out = await listPayments(db, { accountId: 'a', actor: owner, query: { employee_id: 'abc' }, now }, repos);
  assert.equal(calls[0].employeeId, NIL_UUID);
  assert.deepEqual(out, { payments: [], hasMore: false });
  await listPayments(db, { accountId: 'a', actor: owner, query: { employee_id: U }, now }, repos);
  assert.equal(calls[1].employeeId, U);
});

test('getPaymentsSummary: employee_id no UUID se consulta como inexistente, en ambas consultas', async () => {
  const calls = [];
  const repos = {
    payments: {
      summarize: async (d, args) => { calls.push(args.employeeId); return { totalAmount: 0 }; },
      summarizeByEmployee: async (d, args) => { calls.push(args.employeeId); return []; },
    },
  };
  await getPaymentsSummary(db, { accountId: 'a', actor: owner, query: { employee_id: 'abc' }, now }, repos);
  assert.deepEqual(calls, [NIL_UUID, NIL_UUID]);
});
