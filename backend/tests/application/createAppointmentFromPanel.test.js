import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppointmentFromPanel } from '../../src/application/createAppointmentFromPanel.js';

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const makeRepos = (o = {}) => ({
  services: {
    findActive: async () => ({ id: 'svc-1', duration_minutes: 60, price: '50.00' }),
    findById: async () => ({ id: 'svc-1', duration_minutes: 60, price: '50.00' }),
    ...o.services,
  },
  clients: {
    findById: async () => ({ id: 'cli-1', account_id: 'acc-1' }),
    findOrCreate: async () => ({ id: 'cli-new' }),
    ...o.clients,
  },
  users: {
    findById: async () => ({ id: 'usr-9', account_id: 'acc-1', commission_rate: null }),
    findWithAvailability: async () => [],
    ...o.users,
  },
  appointments: {
    create: async (db, data) => ({ id: 'apt-1', ...data }),
    findBusinessBlock: async () => null,
    findUserConflict: async () => null,
    ...o.appointments,
  },
  accounts: { findById: async () => ({ id: 'acc-1', commission_rate: null }), ...o.accounts },
  payments: { create: async () => ({ id: 'pay-1' }), ...o.payments },
  tokens: { create: async () => {}, ...o.tokens },
});

const db = { transaction: async (fn) => fn(db) };
const base = { accountId: 'acc-1', serviceId: 'svc-1', clientId: 'cli-1' };
const owner = { id: 'own-1', role: 'owner' };

test('RF-16: staff queda asignado a sí mismo e ignora el profesional recibido', async () => {
  const repos = makeRepos();
  const { appointment } = await createAppointmentFromPanel(db, {
    ...base, actor: { id: 'stf-1', role: 'staff' }, employeeId: 'otro-prof', scheduledAt: FUTURE,
  }, repos);
  assert.equal(appointment.assigned_user_id, 'stf-1');
});

test('RF-5: profesional explícito no dispara chequeo de disponibilidad', async () => {
  let availabilityChecked = false;
  const repos = makeRepos({
    users: {
      findById: async () => ({ id: 'usr-9', account_id: 'acc-1' }),
      findWithAvailability: async () => { availabilityChecked = true; return []; },
    },
  });
  const { appointment } = await createAppointmentFromPanel(db, {
    ...base, actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE,
  }, repos);
  assert.equal(appointment.assigned_user_id, 'usr-9');
  assert.equal(availabilityChecked, false);
});

test('RF-7: sin profesional y nadie disponible → 409', async () => {
  const repos = makeRepos({ users: { findWithAvailability: async () => [] } });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, scheduledAt: FUTURE }, repos),
    { message: 'no_professional_available', status: 409 },
  );
});

test('RF-17: turno futuro nace agendado y genera enlace', async () => {
  let tokenCreated = 0;
  const repos = makeRepos({ tokens: { create: async () => { tokenCreated++; } } });
  const res = await createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE }, repos);
  assert.equal(res.appointment.status, 'agendado');
  assert.ok(res.access_token);
  assert.equal(tokenCreated, 1);
});

test('RF-9 / RF-18: turno con fin pasado nace completado, genera pago y NO enlace', async () => {
  let tokenCreated = 0;
  let paymentCreated = 0;
  const repos = makeRepos({
    tokens: { create: async () => { tokenCreated++; } },
    payments: { create: async () => { paymentCreated++; return { id: 'pay-1' }; } },
  });
  const res = await createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: PAST }, repos);
  assert.equal(res.appointment.status, 'completado');
  assert.equal(res.access_token, undefined);
  assert.equal(tokenCreated, 0);
  assert.equal(paymentCreated, 1);
});

test('RF-9: si falla el pago, se propaga el error (rollback de la transacción)', async () => {
  const repos = makeRepos({ payments: { create: async () => { throw new Error('boom'); } } });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: PAST }, repos),
    { message: 'boom' },
  );
});

test('RF-13: client_id de otra cuenta → 404', async () => {
  const repos = makeRepos({ clients: { findById: async () => ({ id: 'cli-1', account_id: 'otra' }) } });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE }, repos),
    { message: 'client_not_found', status: 404 },
  );
});

test('RF-11: servicio inexistente → 404', async () => {
  const repos = makeRepos({ services: { findActive: async () => null } });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE }, repos),
    { message: 'service_not_found', status: 404 },
  );
});

test('RF-10: el error de solapamiento del trigger se mapea a 409', async () => {
  const repos = makeRepos({
    appointments: { create: async () => { throw Object.assign(new Error('x'), { cause: { message: 'appointment_overlap' } }); } },
  });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE }, repos),
    { message: 'appointment_overlap', status: 409 },
  );
});

test('RF-3: datos de cliente nuevo → find-or-create y se usa el id devuelto', async () => {
  let forwarded;
  const repos = makeRepos({
    clients: { findOrCreate: async (d, keys, defaults) => { forwarded = defaults; return { id: 'cli-new' }; } },
  });
  const { appointment } = await createAppointmentFromPanel(db, {
    accountId: 'acc-1', serviceId: 'svc-1', actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE,
    clientData: { name: 'Nuevo', email: 'MAYUS@T.com' },
  }, repos);
  assert.equal(appointment.client_id, 'cli-new');
  assert.equal(forwarded.email, 'mayus@t.com'); // normalizado
  assert.equal(forwarded.account_id, 'acc-1');
});

test('RF-14: profesional inexistente o de otra cuenta → 404', async () => {
  const otra = makeRepos({ users: { findById: async () => ({ id: 'usr-9', account_id: 'otra' }) } });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'usr-9', scheduledAt: FUTURE }, otra),
    { message: 'professional_not_found', status: 404 },
  );
  const noExiste = makeRepos({ users: { findById: async () => null } });
  await assert.rejects(
    () => createAppointmentFromPanel(db, { ...base, actor: owner, employeeId: 'x', scheduledAt: FUTURE }, noExiste),
    { message: 'professional_not_found', status: 404 },
  );
});

test('RF-6: sin profesional, autoasigna al que tiene disponibilidad y sin conflicto', async () => {
  const repos = makeRepos({
    users: {
      findWithAvailability: async () => [{
        id: 'auto-1',
        availability: Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, start_time: '00:00:00', end_time: '23:59:59' })),
      }],
    },
  });
  const { appointment } = await createAppointmentFromPanel(db, { ...base, actor: owner, scheduledAt: FUTURE }, repos);
  assert.equal(appointment.assigned_user_id, 'auto-1');
});
