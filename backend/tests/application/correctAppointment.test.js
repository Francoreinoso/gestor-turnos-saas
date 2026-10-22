import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctAppointment } from '../../src/application/correctAppointment.js';

const db = { transaction: async (fn) => fn(db) };
const now = new Date('2026-09-17T12:00:00Z');
const owner = { id: 'own-1', role: 'owner' };
const staffOwn = { id: 'usr-1', role: 'staff' };
const staffOther = { id: 'usr-2', role: 'staff' };

const baseAppointment = {
  id: 'appt-1',
  account_id: 'acc-1',
  status: 'completado',
  scheduled_at: new Date('2026-09-17T10:00:00Z'), // hoy — dentro de ventana
  service_id: 'svc-1',
  assigned_user_id: 'usr-1',
};

const makeRepos = (calls, o = {}) => ({
  appointments: {
    findOne: async () => baseAppointment,
    update: async (db, id, data) => { calls.push(['update', id, data]); return { ...baseAppointment, ...data }; },
    ...o.appointments,
  },
  payments: {
    create: async (db, data) => { calls.push(['payments.create', data]); return data; },
    deleteByAppointment: async (db, id) => { calls.push(['payments.deleteByAppointment', id]); },
    ...o.payments,
  },
  services: { findById: async () => ({ price: '100.00' }), ...o.services },
  users: { findById: async () => ({ commission_rate: '0.4000' }), ...o.users },
  accounts: { findById: async () => ({ commission_rate: null }), ...o.accounts },
});

// T10 — RF-19, RF-20

test('turno no encontrado → 404', async () => {
  const repos = makeRepos([], { appointments: { findOne: async () => undefined } });
  await assert.rejects(
    () => correctAppointment(db, { id: 'nope', accountId: 'acc-1', actor: owner, now }, repos),
    { status: 404 },
  );
});

test('transición inválida (turno agendado) → 422, sin llegar a la ventana', async () => {
  const repos = makeRepos([], { appointments: { findOne: async () => ({ ...baseAppointment, status: 'agendado' }) } });
  await assert.rejects(
    () => correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: owner, now }, repos),
    { status: 422, message: 'invalid_status_transition' },
  );
});

test('ventana vencida (3 días después) → 422, ni update ni create/delete de payment se llaman', async () => {
  const calls = [];
  const repos = makeRepos(calls);
  const lateNow = new Date('2026-09-20T12:00:00Z');
  await assert.rejects(
    () => correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: owner, now: lateNow }, repos),
    { status: 422, message: 'correction_window_expired' },
  );
  assert.deepEqual(calls, []);
});

test('dentro de ventana, completado → no_llego: actualiza estado y borra el pago', async () => {
  const calls = [];
  const repos = makeRepos(calls);
  const result = await correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: owner, now }, repos);
  assert.equal(result.status, 'no_llego');
  assert.deepEqual(calls, [
    ['update', 'appt-1', { status: 'no_llego' }],
    ['payments.deleteByAppointment', 'appt-1'],
  ]);
});

test('dentro de ventana, no_llego → completado: actualiza estado y crea el pago', async () => {
  const calls = [];
  const repos = makeRepos(calls, { appointments: { findOne: async () => ({ ...baseAppointment, status: 'no_llego' }) } });
  const result = await correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: owner, now }, repos);
  assert.equal(result.status, 'completado');
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[1][0], 'payments.create');
});

test('ventana vencida en sentido inverso (no_llego → completado) → 422, sin crear el pago', async () => {
  const calls = [];
  const repos = makeRepos(calls, { appointments: { findOne: async () => ({ ...baseAppointment, status: 'no_llego' }) } });
  const lateNow = new Date('2026-09-20T12:00:00Z');
  await assert.rejects(
    () => correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: owner, now: lateNow }, repos),
    { status: 422, message: 'correction_window_expired' },
  );
  assert.deepEqual(calls, []);
});

// spec 010 RF-1 — alcance por rol

test('staff ajeno → 404 y ningún repo de pagos ni update se llama', async () => {
  const calls = [];
  const repos = makeRepos(calls);
  await assert.rejects(
    () => correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: staffOther, now }, repos),
    { status: 404, message: 'not_found' },
  );
  assert.deepEqual(calls, []);
});

test('staff ajeno sobre un turno agendado → 404, no 422 (el alcance va antes de la transición)', async () => {
  const repos = makeRepos([], { appointments: { findOne: async () => ({ ...baseAppointment, status: 'agendado' }) } });
  await assert.rejects(
    () => correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: staffOther, now }, repos),
    { status: 404, message: 'not_found' },
  );
});

test('bloqueo de negocio con staff → 404', async () => {
  const repos = makeRepos([], { appointments: { findOne: async () => ({ ...baseAppointment, status: 'bloqueado', assigned_user_id: null }) } });
  await assert.rejects(
    () => correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: staffOwn, now }, repos),
    { status: 404, message: 'not_found' },
  );
});

test('staff propio corrige su turno', async () => {
  const calls = [];
  const result = await correctAppointment(db, { id: 'appt-1', accountId: 'acc-1', actor: staffOwn, now }, makeRepos(calls));
  assert.equal(result.status, 'no_llego');
});
