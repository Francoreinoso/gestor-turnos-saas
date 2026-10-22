import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStaffAvailability } from '../../src/application/getStaffAvailability.js';

const makeRepos = (o = {}) => ({
  users: {
    findVisible: async () => ({ id: 'stf-1', role: 'staff', status: 'activo' }),
    ...o.users,
  },
  availability: {
    findByUser: async () => [{ day_of_week: 1, start_time: '09:00:00', end_time: '13:00:00' }],
    ...o.availability,
  },
});

const db = {};
const owner = { id: 'own-1', role: 'owner' };
const base = { id: 'stf-1', accountId: 'acc-1', actor: owner };

test('trabajador de otra cuenta (o inexistente) → 404', async () => {
  const repos = makeRepos({ users: { findVisible: async () => undefined } });
  await assert.rejects(() => getStaffAvailability(db, base, repos), { status: 404 }); // RF-15
});

test('id de un owner → 404 (el owner no tiene horario)', async () => {
  const repos = makeRepos({ users: { findVisible: async () => ({ id: 'own-1', role: 'owner', status: 'activo' }) } });
  await assert.rejects(() => getStaffAvailability(db, { ...base, id: 'own-1' }, repos), { status: 404 }); // RF-15, D5
});

test('staff pidiendo el horario de un compañero → 404, sin consultar ventanas', async () => {
  let queried = false;
  const repos = makeRepos({ availability: { findByUser: async () => { queried = true; return []; } } });
  await assert.rejects(
    () => getStaffAvailability(db, { ...base, actor: { id: 'stf-2', role: 'staff' } }, repos),
    { status: 404 }, // RF-15, RF-16
  );
  assert.equal(queried, false);
});

test('owner y staff-self reciben el horario con horas HH:MM', async () => {
  const repos = makeRepos();
  const expected = [{ day_of_week: 1, start_time: '09:00', end_time: '13:00' }];
  assert.deepEqual(await getStaffAvailability(db, base, repos), expected); // RF-13, RF-2
  assert.deepEqual(await getStaffAvailability(db, { ...base, actor: { id: 'stf-1', role: 'staff' } }, repos), expected); // RF-14
});

test('sin ventanas → lista vacía', async () => {
  const repos = makeRepos({ availability: { findByUser: async () => [] } });
  assert.deepEqual(await getStaffAvailability(db, base, repos), []); // RF-1
});
