import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAppointments } from '../../src/application/listAppointments.js';

const makeRepos = (spy) => ({
  appointments: {
    findForList: async (db, args) => { spy.args = args; return spy.rows ?? []; },
  },
});

const db = {};

test('RF-39: date_from inválida → 400', async () => {
  await assert.rejects(
    () => listAppointments(db, { accountId: 'acc-1', actor: { role: 'owner' }, query: { date_from: 'ayer' } }, makeRepos({})),
    { message: 'invalid_date', status: 400 },
  );
});

test('RF-40: date_from posterior a date_to → [] sin tocar el repo', async () => {
  const spy = {};
  const res = await listAppointments(db, {
    accountId: 'acc-1', actor: { role: 'owner' },
    query: { date_from: '2026-09-10T00:00:00Z', date_to: '2026-09-01T00:00:00Z' },
  }, makeRepos(spy));
  assert.deepEqual(res, []);
  assert.equal(spy.args, undefined);
});

test('RF-41: se pasa limit 500 al repo', async () => {
  const spy = {};
  await listAppointments(db, { accountId: 'acc-1', actor: { role: 'owner' }, query: {} }, makeRepos(spy));
  assert.equal(spy.args.limit, 500);
});

test('RF-42: staff fuerza el filtro de profesional a su propio id', async () => {
  const spy = {};
  await listAppointments(db, {
    accountId: 'acc-1', actor: { id: 'stf-1', role: 'staff' }, query: { employee_id: 'otro' },
  }, makeRepos(spy));
  assert.equal(spy.args.filters.employeeId, 'stf-1');
});

test('RF-37: `type` funciona como alias de `status`', async () => {
  const spy = {};
  await listAppointments(db, { accountId: 'acc-1', actor: { role: 'owner' }, query: { type: 'agendado' } }, makeRepos(spy));
  assert.equal(spy.args.filters.status, 'agendado');
});

// spec 008 RF-6
test('owner con employee_id que no es UUID → 400 invalid_body sin consultar el repo', async () => {
  const spy = {};
  await assert.rejects(
    () => listAppointments(db, { accountId: 'acc-1', actor: { role: 'owner' }, query: { employee_id: 'abc' } }, makeRepos(spy)),
    { status: 400, message: 'invalid_body' },
  );
  assert.equal(spy.args, undefined);
});

test('owner con employee_id UUID válido (aunque no exista) → se consulta con ese filtro', async () => {
  const spy = {};
  const id = '123e4567-e89b-12d3-a456-426614174000';
  await listAppointments(db, { accountId: 'acc-1', actor: { role: 'owner' }, query: { employee_id: id } }, makeRepos(spy));
  assert.equal(spy.args.filters.employeeId, id);
});
