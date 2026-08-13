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

test('crea un turno con profesional provisto', async () => {
  const repos = makeRepos();
  const { appointment } = await createAppointment(db, {
    accountId: 'acc-1',
    serviceId: 'svc-1',
    scheduledAt: new Date('2026-09-01T10:00:00Z'),
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
      clientId: 'cli-1',
      employeeId: 'usr-1',
    }, repos),
    { message: 'service_not_found', status: 404 }
  );
});
