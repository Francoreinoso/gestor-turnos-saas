import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescheduleAppointment } from '../../src/application/rescheduleAppointment.js';

const makeOld = (overrides = {}) => ({
  id: 'apt-old',
  account_id: 'acc-1',
  service_id: 'svc-1',
  client_id: 'cli-1',
  assigned_user_id: 'usr-1',
  notes: 'nota original',
  status: 'agendado',
  ...overrides,
});

const makeRepos = (overrides = {}) => ({
  services: { findActive: async () => ({ id: 'svc-1', duration_minutes: 60 }), ...overrides.services },
  clients:  { findOrCreate: async () => ({ id: 'cli-1' }), ...overrides.clients },
  appointments: {
    update: async () => {},
    create: async (_db, data) => ({ id: 'apt-new', ...data }),
    findBusinessBlock: async () => null,
    findUserConflict:  async () => null,
    ...overrides.appointments,
  },
  tokens: { create: async () => {}, ...overrides.tokens },
  users:  { findWithAvailability: async () => [], ...overrides.users },
});

// db stub: ejecuta el callback de transaction en el mismo objeto
const db = { transaction: async (fn) => fn(db) };

const scheduledAt = new Date('2026-10-01T10:00:00Z');
// spec 005 RF-10: la fecha fija ya es pasado; se fija un `now` anterior.
const now = new Date('2026-01-01T00:00:00Z');

test('lanza 422 si el turno no está en estado agendado', async () => {
  for (const status of ['en_progreso', 'completado', 'cancelado', 'no_llego', 'bloqueado']) {
    await assert.rejects(
      () => rescheduleAppointment(db, makeOld({ status }), { scheduledAt, now }, makeRepos()),
      { message: 'invalid_status_transition', status: 422 }
    );
  }
});

test('cancela el turno original dentro de la transacción', async () => {
  let cancelledId, cancelledWith;
  const repos = makeRepos({
    appointments: {
      update: async (_db, id, data) => { cancelledId = id; cancelledWith = data; },
      create: async (_db, data) => ({ id: 'apt-new', ...data }),
      findBusinessBlock: async () => null,
      findUserConflict:  async () => null,
    },
  });

  await rescheduleAppointment(db, makeOld(), { scheduledAt, now, employeeId: 'usr-1' }, repos);

  assert.equal(cancelledId, 'apt-old');
  assert.deepEqual(cancelledWith, { status: 'cancelado' });
});

test('el turno nuevo hereda account_id y client_id del original', async () => {
  let created;
  const repos = makeRepos({
    appointments: {
      update: async () => {},
      create: async (_db, data) => { created = data; return { id: 'apt-new', ...data }; },
      findBusinessBlock: async () => null,
      findUserConflict:  async () => null,
    },
  });

  await rescheduleAppointment(db, makeOld(), { scheduledAt, now, employeeId: 'usr-1' }, repos);

  assert.equal(created.account_id, 'acc-1');
  assert.equal(created.client_id, 'cli-1');
  assert.equal(created.status, 'agendado');
});

test('usa service_id del original si no se pasa uno nuevo', async () => {
  let usedServiceId;
  const repos = makeRepos({
    services: { findActive: async (_db, id) => { usedServiceId = id; return { id, duration_minutes: 60 }; } },
  });

  await rescheduleAppointment(db, makeOld({ service_id: 'svc-original' }), { scheduledAt, now, employeeId: 'usr-1' }, repos);

  assert.equal(usedServiceId, 'svc-original');
});

test('usa assigned_user_id del original si no se pasa employeeId', async () => {
  let created;
  const repos = makeRepos({
    appointments: {
      update: async () => {},
      create: async (_db, data) => { created = data; return { id: 'apt-new', ...data }; },
      findBusinessBlock: async () => null,
      findUserConflict:  async () => null,
    },
  });

  await rescheduleAppointment(db, makeOld({ assigned_user_id: 'usr-original' }), { scheduledAt, now }, repos);

  assert.equal(created.assigned_user_id, 'usr-original');
});

test('usa notes del original si no se pasan', async () => {
  let created;
  const repos = makeRepos({
    appointments: {
      update: async () => {},
      create: async (_db, data) => { created = data; return { id: 'apt-new', ...data }; },
      findBusinessBlock: async () => null,
      findUserConflict:  async () => null,
    },
  });

  await rescheduleAppointment(db, makeOld({ notes: 'nota vieja' }), { scheduledAt, now, employeeId: 'usr-1' }, repos);

  assert.equal(created.notes, 'nota vieja');
});

// spec 005 RF-10
test('RF-10: reprogramar al pasado → 422 y el turno original NO se cancela', async () => {
  let updated = false, created = false;
  const repos = makeRepos({
    appointments: {
      update: async () => { updated = true; },
      create: async () => { created = true; },
      findBusinessBlock: async () => null,
      findUserConflict: async () => null,
    },
  });

  await assert.rejects(
    () => rescheduleAppointment(db, makeOld(), { scheduledAt, now: new Date('2026-10-01T10:00:00Z') }, repos),
    { message: 'appointment_in_past', status: 422 },
  );
  assert.equal(updated, false);
  assert.equal(created, false);
});

test('RF-10b: reprogramar con scheduledAt inválido → 400 y el original no se cancela', async () => {
  let updated = false;
  const repos = makeRepos({ appointments: { update: async () => { updated = true; } } });

  await assert.rejects(
    () => rescheduleAppointment(db, makeOld(), { scheduledAt: 'x', now }, repos),
    { message: 'invalid_scheduled_at', status: 400 },
  );
  assert.equal(updated, false);
});
