// spec 008 RF-20 — createPayment no lanza consultas en paralelo: puede correr sobre el cliente de una transacción,
// que (pg) no admite consultas simultáneas y ya emite una advertencia de deprecación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayment } from '../../src/application/createPayment.js';

const appointment = { id: 'ap-1', service_id: 'svc-1', assigned_user_id: 'usr-1', account_id: 'acc-1' };

// Cada lectura "tarda" un tick; si dos se solapan, `maxInFlight` pasa de 1.
const makeRepos = () => {
  const state = { inFlight: 0, maxInFlight: 0, order: [], created: null };
  const read = (name, value) => async () => {
    state.order.push(`start:${name}`);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    state.inFlight -= 1;
    state.order.push(`end:${name}`);
    return value;
  };
  const repos = {
    services: { findById: read('service', { price: '100.00' }) },
    users: { findById: read('user', { commission_rate: '0.5000' }) },
    accounts: { findById: read('account', { commission_rate: '0.4000' }) },
    payments: { create: async (db, data) => { state.created = data; return data; } },
  };
  return { repos, state };
};

test('las lecturas se ejecutan una detrás de otra, nunca en paralelo — RF-20', async () => {
  const { repos, state } = makeRepos();
  await createPayment({}, appointment, repos);
  assert.equal(state.maxInFlight, 1, `consultas simultáneas: ${state.maxInFlight}`);
  assert.deepEqual(state.order, ['start:service', 'end:service', 'start:user', 'end:user', 'start:account', 'end:account']);
});

test('el resultado no cambia: aplica la comisión del profesional sobre el precio del servicio', async () => {
  const { repos, state } = makeRepos();
  await createPayment({}, appointment, repos);
  assert.equal(state.created.amount, '100.00');
  assert.equal(Number(state.created.commission_rate_applied), 0.5);
  assert.equal(Number(state.created.employee_amount) + Number(state.created.business_amount), 100);
});

test('un turno sin profesional asignado no consulta usuarios', async () => {
  const { repos, state } = makeRepos();
  await createPayment({}, { ...appointment, assigned_user_id: null }, repos);
  assert.ok(!state.order.some((e) => e.includes('user')));
  assert.equal(state.maxInFlight, 1);
});
