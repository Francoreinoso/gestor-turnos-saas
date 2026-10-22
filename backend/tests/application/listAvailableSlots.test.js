import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAvailableSlots } from '../../src/application/listAvailableSlots.js';

const db = {};

// Fechas locales (el cálculo de ventanas usa la hora local del servidor, igual que antes de la extracción).
const day = (h = 0, m = 0) => new Date(2030, 0, 7, h, m, 0, 0); // lunes 7/1/2030
const MONDAY = 1;

const makeRepos = (o = {}) => ({
  services: { findActive: async () => ({ id: 'svc-1', duration_minutes: 60 }), ...o.services },
  users: {
    findWithAvailability: async () => [{
      id: 'usr-1',
      availability: [{ day_of_week: MONDAY, start_time: '09:00:00', end_time: '12:00:00' }],
    }],
    ...o.users,
  },
  appointments: { findTakenSlots: async () => [], ...o.appointments },
});

const input = (extra = {}) => ({
  businessId: 'acc-1', serviceId: 'svc-1', from: day(0), to: new Date(2030, 0, 8, 0, 0), ...extra,
});
const starts = (slots) => slots.map(s => new Date(s.starts_at).getHours());

test('404 service_not_found si el servicio no está activo', async () => {
  const repos = makeRepos({ services: { findActive: async () => undefined } });
  await assert.rejects(() => listAvailableSlots(db, input({ now: day(0) }), repos), { message: 'service_not_found', status: 404 });
});

test('regresión: ventana de 3 h con servicio de 60 min → 3 slots', async () => {
  const slots = await listAvailableSlots(db, input({ now: new Date(2030, 0, 1) }), makeRepos());
  assert.deepEqual(starts(slots), [9, 10, 11]);
  assert.equal(slots[0].employee_id, 'usr-1');
  assert.equal(slots[0].ends_at, day(10).toISOString());
});

test('regresión: ventana multi-tramo', async () => {
  const repos = makeRepos({ users: { findWithAvailability: async () => [{
    id: 'usr-1',
    availability: [
      { day_of_week: MONDAY, start_time: '09:00:00', end_time: '10:00:00' },
      { day_of_week: MONDAY, start_time: '15:00:00', end_time: '17:00:00' },
    ],
  }] } });
  const slots = await listAvailableSlots(db, input({ now: new Date(2030, 0, 1) }), repos);
  assert.deepEqual(starts(slots), [9, 15, 16]);
});

test('regresión: un turno ocupado del mismo profesional saca ese slot', async () => {
  const repos = makeRepos({ appointments: { findTakenSlots: async () => [
    { assigned_user_id: 'usr-1', scheduled_at: day(10), scheduled_until: day(11) },
  ] } });
  const slots = await listAvailableSlots(db, input({ now: new Date(2030, 0, 1) }), repos);
  assert.deepEqual(starts(slots), [9, 11]);
});

test('regresión: el turno de otro profesional no afecta', async () => {
  const repos = makeRepos({ appointments: { findTakenSlots: async () => [
    { assigned_user_id: 'otro', scheduled_at: day(10), scheduled_until: day(11) },
  ] } });
  const slots = await listAvailableSlots(db, input({ now: new Date(2030, 0, 1) }), repos);
  assert.deepEqual(starts(slots), [9, 10, 11]);
});

test('regresión: un bloqueo de negocio (assigned_user_id null) saca el slot para todos', async () => {
  const repos = makeRepos({ appointments: { findTakenSlots: async () => [
    { assigned_user_id: null, scheduled_at: day(9), scheduled_until: day(10, 30) },
  ] } });
  const slots = await listAvailableSlots(db, input({ now: new Date(2030, 0, 1) }), repos);
  assert.deepEqual(starts(slots), [11]);
});

test('pide los turnos ocupados de la cuenta en el rango [from, to)', async () => {
  let args;
  const repos = makeRepos({ appointments: { findTakenSlots: async (_db, a) => { args = a; return []; } } });
  const i = input({ now: new Date(2030, 0, 1) });
  await listAvailableSlots(db, i, repos);
  assert.deepEqual(args, { accountId: 'acc-1', from: i.from, to: i.to });
});

test('pasa employeeId al repo de disponibilidad', async () => {
  let received;
  const repos = makeRepos({ users: { findWithAvailability: async (_db, _acc, uid) => { received = uid; return []; } } });
  await listAvailableSlots(db, input({ employeeId: 'usr-9', now: new Date(2030, 0, 1) }), repos);
  assert.equal(received, 'usr-9');
});

// RF-9
test('RF-9: descarta slots con inicio <= now (incluido el de inicio exacto) y mantiene los posteriores', async () => {
  const slots = await listAvailableSlots(db, input({ now: day(10) }), makeRepos());
  assert.deepEqual(starts(slots), [11]);
});

test('RF-9: now en medio de un slot descarta ese slot ya empezado', async () => {
  const slots = await listAvailableSlots(db, input({ now: day(9, 30) }), makeRepos());
  assert.deepEqual(starts(slots), [10, 11]);
});

test('RF-9: now posterior a toda la ventana → sin slots', async () => {
  const slots = await listAvailableSlots(db, input({ now: day(13) }), makeRepos());
  assert.deepEqual(slots, []);
});

// Cambio de hora: en America/Santiago (zona por defecto del proyecto) el horario de verano de 2026 empieza la noche del
// sábado 5 al domingo 6 de septiembre. Las ventanas son hora de pared: las 09:00 se mantienen aunque el desfase con UTC
// cambie. En cualquier otra zona (por ejemplo UTC, en la CI) la aserción vale igual; solo es "interesante" en Santiago.
test('el fin de semana del cambio de hora, cada ventana empieza a la misma hora local', async () => {
  const weekend = [6, 0].map(d => ({ day_of_week: d, start_time: '09:00:00', end_time: '13:00:00' }));
  const repos = makeRepos({ users: { findWithAvailability: async () => [{ id: 'usr-1', availability: weekend }] } });
  const slots = await listAvailableSlots(db, {
    businessId: 'acc-1', serviceId: 'svc-1',
    from: new Date(2026, 8, 5, 0, 0), to: new Date(2026, 8, 8, 0, 0),
    now: new Date('2026-08-01T00:00:00Z'),
  }, repos);

  const byDay = (d) => slots.filter(s => new Date(s.starts_at).getDate() === d).map(s => new Date(s.starts_at).getHours());
  assert.deepEqual(byDay(5), [9, 10, 11, 12]); // sábado
  assert.deepEqual(byDay(6), [9, 10, 11, 12]); // domingo, ya con el horario nuevo
  assert.equal(slots.length, 8);
});
