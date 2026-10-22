import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createAppointment } from '../../src/application/createAppointment.js';

const makeRepos = (overrides = {}) => ({
  services: {
    findActive: async () => ({ id: 'svc-1', duration_minutes: 60 }),
    ...overrides.services,
  },
  clients: {
    findOrCreate: async () => ({ id: 'cli-1' }),
    ...overrides.clients,
  },
  appointments: {
    create: async (db, data) => ({ id: 'apt-1', ...data }),
    findBusinessBlock: async () => null,
    findUserConflict: async () => null,
    ...overrides.appointments,
  },
  tokens: {
    create: async () => {},
    ...overrides.tokens,
  },
  users: {
    findWithAvailability: async () => [],
    ...overrides.users,
  },
});

// db stub — no hace nada real
const db = {};
// spec 005 RF-10: las fechas fijas de estos tests ya son pasado; se fija un `now` anterior.
const now = new Date('2026-01-01T00:00:00Z');

test('crea un turno con profesional provisto', async () => {
  const repos = makeRepos();
  const { appointment } = await createAppointment(db, {
    accountId: 'acc-1',
    serviceId: 'svc-1',
    scheduledAt: new Date('2026-09-01T10:00:00Z'),
    now,
    clientId: 'cli-1',
    employeeId: 'usr-1',
  }, repos);

  assert.equal(appointment.status, 'agendado');
  assert.equal(appointment.assigned_user_id, 'usr-1');
});

test('lanza 409 si no hay profesional disponible', async () => {
  const repos = makeRepos({
    users: { findWithAvailability: async () => [] },
  });

  await assert.rejects(
    () => createAppointment(db, {
      accountId: 'acc-1',
      serviceId: 'svc-1',
      scheduledAt: new Date('2026-09-01T10:00:00Z'),
      now,
      clientId: 'cli-1',
      // sin employeeId — fuerza auto-asignación
    }, repos),
    { message: 'no_professional_available', status: 409 }
  );
});

test('lanza 404 si el servicio no existe', async () => {
  const repos = makeRepos({
    services: { findActive: async () => null },
  });

  await assert.rejects(
    () => createAppointment(db, {
      accountId: 'acc-1',
      serviceId: 'svc-x',
      scheduledAt: new Date('2026-09-01T10:00:00Z'),
      now,
      clientId: 'cli-1',
      employeeId: 'usr-1',
    }, repos),
    { message: 'service_not_found', status: 404 }
  );
});

// spec 005 RF-10 / RF-10b
test('RF-10: inicio pasado → 422 appointment_in_past y ningún repo es llamado', async () => {
  const touched = [];
  const spy = (name, ret) => async () => { touched.push(name); return ret; };
  const repos = makeRepos({
    services: { findActive: spy('services.findActive', { id: 'svc-1', duration_minutes: 60 }) },
    clients: { findOrCreate: spy('clients.findOrCreate', { id: 'cli-1' }) },
    appointments: { create: spy('appointments.create', {}), findBusinessBlock: spy('findBusinessBlock', null), findUserConflict: spy('findUserConflict', null) },
    tokens: { create: spy('tokens.create') },
  });

  await assert.rejects(
    () => createAppointment(db, {
      accountId: 'acc-1', serviceId: 'svc-1', clientData: { name: 'X', email: 'x@y.com' },
      scheduledAt: new Date('2026-09-01T10:00:00Z'), now: new Date('2026-09-01T10:00:00Z'),
    }, repos),
    { message: 'appointment_in_past', status: 422 },
  );
  assert.deepEqual(touched, []);
});

test('RF-10b: scheduledAt inválido → 400 invalid_scheduled_at sin escribir nada', async () => {
  let wrote = false;
  const repos = makeRepos({ appointments: { create: async () => { wrote = true; } } });
  for (const bad of ['x', null, undefined]) {
    await assert.rejects(
      () => createAppointment(db, { accountId: 'acc-1', serviceId: 'svc-1', scheduledAt: bad, clientId: 'cli-1', employeeId: 'usr-1', now }, repos),
      { message: 'invalid_scheduled_at', status: 400 },
    );
  }
  assert.equal(wrote, false);
});

test('RF-10: acepta scheduledAt como string ISO futuro', async () => {
  const { appointment } = await createAppointment(db, {
    accountId: 'acc-1', serviceId: 'svc-1', scheduledAt: '2026-09-01T10:00:00Z', clientId: 'cli-1', employeeId: 'usr-1', now,
  }, makeRepos());
  assert.deepEqual(appointment.scheduled_at, new Date('2026-09-01T10:00:00Z'));
});
