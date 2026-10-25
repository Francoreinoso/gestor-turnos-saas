// spec 011 RF-9 — el cliente del asistente cancela solo sus propios turnos agendados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelOwnAppointment } from '../../src/application/assistant/cancelOwnAppointment.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const APPT = '33333333-3333-4333-8333-333333333333';

const makeRepos = (appointment) => {
  const spy = { updates: [] };
  return {
    spy,
    appointments: {
      findForClient: async (db, args) => { spy.lookup = args; return appointment; },
      update: async (db, id, patch) => { spy.updates.push({ id, patch }); return { ...appointment, ...patch }; },
    },
  };
};

test('cancela un turno agendado del cliente, buscándolo por cuenta y cliente de la sesión', async () => {
  const repos = makeRepos({ id: APPT, status: 'agendado' });
  const res = await cancelOwnAppointment({}, { accountId: ACCOUNT, clientId: CLIENT, appointmentId: APPT }, repos);

  assert.equal(res.status, 'cancelado');
  assert.deepEqual(repos.spy.lookup, { id: APPT, accountId: ACCOUNT, clientId: CLIENT });
  assert.deepEqual(repos.spy.updates, [{ id: APPT, patch: { status: 'cancelado' } }]);
});

test('turno de otro cliente, de otra cuenta o inexistente → 404 not_found sin tocar nada', async () => {
  const repos = makeRepos(undefined);
  await assert.rejects(
    () => cancelOwnAppointment({}, { accountId: ACCOUNT, clientId: CLIENT, appointmentId: APPT }, repos),
    { message: 'not_found', status: 404 },
  );
  assert.equal(repos.spy.updates.length, 0);
});

test('id que no es UUID → 404 not_found sin consultar la base', async () => {
  const repos = makeRepos({ id: APPT, status: 'agendado' });
  await assert.rejects(
    () => cancelOwnAppointment({}, { accountId: ACCOUNT, clientId: CLIENT, appointmentId: 'no-uuid' }, repos),
    { message: 'not_found', status: 404 },
  );
  assert.equal(repos.spy.lookup, undefined);
});

test('turno que no está agendado → 422 invalid_status_transition', async () => {
  for (const status of ['cancelado', 'completado', 'en_progreso', 'no_llego', 'bloqueado']) {
    const repos = makeRepos({ id: APPT, status });
    await assert.rejects(
      () => cancelOwnAppointment({}, { accountId: ACCOUNT, clientId: CLIENT, appointmentId: APPT }, repos),
      { message: 'invalid_status_transition', status: 422 },
      status,
    );
    assert.equal(repos.spy.updates.length, 0);
  }
});
