import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editAppointment } from '../../src/application/editAppointment.js';

const APT = {
  id: 'apt-1', account_id: 'acc-1', status: 'agendado',
  assigned_user_id: 'usr-1', service_id: 'svc-1', client_id: 'cli-1',
  scheduled_at: new Date('2026-09-01T10:00:00Z'),
  scheduled_until: new Date('2026-09-01T11:00:00Z'),
};

const makeRepos = (o = {}) => ({
  appointments: {
    findVisible: async () => ({ ...APT }),
    update: async (db, id, patch) => ({ ...APT, ...patch }),
    ...o.appointments,
  },
  services: { findActive: async () => ({ id: 'svc-2', duration_minutes: 90 }), ...o.services },
  clients: { findById: async () => ({ id: 'cli-2', account_id: 'acc-1' }), ...o.clients },
  users: { findById: async () => ({ id: 'usr-2', account_id: 'acc-1' }), ...o.users },
});

const db = {};
const owner = { id: 'own-1', role: 'owner' };
const ctx = (over = {}) => ({ id: 'apt-1', accountId: 'acc-1', actor: owner, body: { notes: 'x' }, ...over });

test('RF-22: campo no editable en el body → 400', async () => {
  await assert.rejects(() => editAppointment(db, ctx({ body: { status: 'cancelado' } }), makeRepos()),
    { message: 'invalid_field', status: 400 });
});

test('RF-34: turno de otra cuenta → 404', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => null } });
  await assert.rejects(() => editAppointment(db, ctx(), repos), { message: 'not_found', status: 404 });
});

test('RF-34: staff sobre turno de otro profesional → 404', async () => {
  await assert.rejects(
    () => editAppointment(db, ctx({ actor: { id: 'otro', role: 'staff' } }), makeRepos()),
    { message: 'not_found', status: 404 },
  );
});

test('RF-33: staff reasignando a otro profesional → 403', async () => {
  await assert.rejects(
    () => editAppointment(db, ctx({ actor: { id: 'usr-1', role: 'staff' }, body: { assigned_user_id: 'usr-2' } }), makeRepos()),
    { message: 'forbidden', status: 403 },
  );
});

test('RF-23: turno no agendado → 422', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => ({ ...APT, status: 'completado' }), update: async () => ({}) } });
  await assert.rejects(() => editAppointment(db, ctx(), repos), { message: 'invalid_status_transition', status: 422 });
});

test('RF-25: cambiar el servicio recalcula el fin con el mismo inicio', async () => {
  const updated = await editAppointment(db, ctx({ body: { service_id: 'svc-2' } }), makeRepos());
  assert.deepEqual(updated.scheduled_at, APT.scheduled_at);
  assert.deepEqual(updated.scheduled_until, new Date('2026-09-01T11:30:00Z')); // 10:00 + 90min
});

test('RF-26: servicio nuevo inexistente → 404', async () => {
  const repos = makeRepos({ services: { findActive: async () => null } });
  await assert.rejects(() => editAppointment(db, ctx({ body: { service_id: 'nope' } }), repos),
    { message: 'service_not_found', status: 404 });
});

test('RF-27: cliente nuevo inexistente o de otra cuenta → 404', async () => {
  const otra = makeRepos({ clients: { findById: async () => ({ id: 'cli-2', account_id: 'otra' }) } });
  await assert.rejects(() => editAppointment(db, ctx({ body: { client_id: 'cli-2' } }), otra),
    { message: 'client_not_found', status: 404 });
  const noExiste = makeRepos({ clients: { findById: async () => null } });
  await assert.rejects(() => editAppointment(db, ctx({ body: { client_id: 'x' } }), noExiste),
    { message: 'client_not_found', status: 404 });
});

test('RF-28: profesional nuevo de otra cuenta → 404', async () => {
  const repos = makeRepos({ users: { findById: async () => ({ id: 'usr-2', account_id: 'otra' }) } });
  await assert.rejects(() => editAppointment(db, ctx({ body: { assigned_user_id: 'usr-2' } }), repos),
    { message: 'professional_not_found', status: 404 });
});

test('RF-29: el solapamiento del trigger se mapea a 409', async () => {
  const repos = makeRepos({
    appointments: {
      findVisible: async () => ({ ...APT }),
      update: async () => { throw Object.assign(new Error('x'), { cause: { message: 'appointment_overlap' } }); },
    },
  });
  await assert.rejects(() => editAppointment(db, ctx({ body: { assigned_user_id: 'usr-2' } }), repos),
    { message: 'appointment_overlap', status: 409 });
});

test('caso feliz: edita notas y devuelve el turno', async () => {
  const updated = await editAppointment(db, ctx({ body: { notes: null } }), makeRepos());
  assert.equal(updated.notes, null);
});
