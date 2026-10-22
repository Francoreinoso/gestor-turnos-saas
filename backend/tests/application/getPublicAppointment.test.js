import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicAppointment } from '../../src/application/getPublicAppointment.js';

const db = {};
const start = new Date('2030-01-01T10:00:00Z');
const end = new Date('2030-01-01T10:30:00Z');

const makeRepos = (o = {}) => ({
  appointments: {
    findById: async () => ({ id: 'apt-1', account_id: 'acc-1' }),
    findVisible: async () => ({
      id: 'apt-1', status: 'agendado', scheduled_at: start, scheduled_until: end, notes: 'nota privada',
      client: { id: 'cli-1', name: 'Cliente', email: 'c@x.com', phone: '+5491155551234' },
      service: { id: 's1', name: 'Corte', duration_minutes: 30, price: '1500.00' },
      assignedUser: { id: 'u1', name: 'Ana' },
    }),
    ...o.appointments,
  },
  accounts: { findById: async () => ({ id: 'acc-1', business_name: 'Barbería Sur', commission_rate: '0.1' }), ...o.accounts },
});

test('RF-5: devuelve turno, servicio, profesional y nombre del negocio', async () => {
  const res = await getPublicAppointment(db, { id: 'apt-1' }, makeRepos());
  assert.deepEqual(res, {
    id: 'apt-1', account_id: 'acc-1', status: 'agendado', scheduled_at: start, scheduled_until: end,
    service: { id: 's1', name: 'Corte', duration_minutes: 30, price: '1500.00' },
    professional: { id: 'u1', name: 'Ana' },
    business_name: 'Barbería Sur',
  });
});

test('RF-6: no incluye client ni notes aunque el repo los devuelva', async () => {
  const res = await getPublicAppointment(db, { id: 'apt-1' }, makeRepos());
  assert.equal('client' in res, false);
  assert.equal('notes' in res, false);
  assert.doesNotMatch(JSON.stringify(res), /@|\+549|nota privada/);
});

test('bloqueo sin profesional asignado → professional null', async () => {
  const repos = makeRepos({ appointments: { findVisible: async () => ({ id: 'apt-1', status: 'agendado', scheduled_at: start, scheduled_until: end, service: null, assignedUser: null }) } });
  const res = await getPublicAppointment(db, { id: 'apt-1' }, repos);
  assert.equal(res.professional, null);
  assert.equal(res.service, null);
});

test('turno inexistente → 404', async () => {
  const repos = makeRepos({ appointments: { findById: async () => undefined } });
  await assert.rejects(() => getPublicAppointment(db, { id: 'x' }, repos), { message: 'not_found', status: 404 });
});
