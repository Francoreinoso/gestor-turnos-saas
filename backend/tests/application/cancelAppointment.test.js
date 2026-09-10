import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelAppointment } from '../../src/application/cancelAppointment.js';

const makeRepos = (appointment) => ({
  appointments: {
    findById: async () => appointment,
    update: async (db, id, patch) => ({ ...appointment, ...patch }),
  },
});

const db = {};

test('RF-44: cancela un turno agendado', async () => {
  const res = await cancelAppointment(db, 'apt-1', makeRepos({ id: 'apt-1', status: 'agendado' }));
  assert.equal(res.status, 'cancelado');
});

test('RF-45: turno no agendado (bloqueado) → 422', async () => {
  await assert.rejects(
    () => cancelAppointment(db, 'apt-1', makeRepos({ id: 'apt-1', status: 'bloqueado' })),
    { message: 'invalid_status_transition', status: 422 },
  );
});

test('RF-45: turno completado → 422', async () => {
  await assert.rejects(
    () => cancelAppointment(db, 'apt-1', makeRepos({ id: 'apt-1', status: 'completado' })),
    { message: 'invalid_status_transition', status: 422 },
  );
});

test('turno inexistente → null', async () => {
  assert.equal(await cancelAppointment(db, 'x', makeRepos(undefined)), null);
});
