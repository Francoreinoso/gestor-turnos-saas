import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAppointment } from '../../src/application/getAppointment.js';

const APT = { id: 'apt-1', account_id: 'acc-1', assigned_user_id: 'usr-1' };
const makeRepos = (o = {}) => ({ appointments: { findVisible: async () => ({ ...APT }), ...o.appointments } });
const db = {};

test('RF-34: turno de otra cuenta → 404', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => null } });
  await assert.rejects(
    () => getAppointment(db, { id: 'apt-1', accountId: 'acc-1', actor: { role: 'owner' } }, repos),
    { message: 'not_found', status: 404 },
  );
});

test('RF-34: staff sobre turno de otro profesional → 404', async () => {
  await assert.rejects(
    () => getAppointment(db, { id: 'apt-1', accountId: 'acc-1', actor: { id: 'otro', role: 'staff' } }, makeRepos()),
    { message: 'not_found', status: 404 },
  );
});

test('caso feliz: devuelve el turno', async () => {
  const res = await getAppointment(db, { id: 'apt-1', accountId: 'acc-1', actor: { id: 'usr-1', role: 'staff' } }, makeRepos());
  assert.equal(res.id, 'apt-1');
});
