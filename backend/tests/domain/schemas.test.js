// spec 007 — esquemas por área, sin DB: casos felices, cada código, normalización y opcionales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../../src/domain/validation.js';
import { registerBody, loginBody } from '../../src/domain/schemas/auth.js';
import { commissionBody } from '../../src/domain/schemas/accounts.js';
import { createServiceBody, editServiceBody, priceBody } from '../../src/domain/schemas/services.js';
import { createClientBody, editClientBody } from '../../src/domain/schemas/clients.js';
import { panelAppointmentBody, blockBody, editAppointmentBody, listAppointmentsQuery } from '../../src/domain/schemas/appointments.js';
import { inviteStaffBody, editStaffBody, editSelfBody, availabilityWindowsBody } from '../../src/domain/schemas/staff.js';
import { paymentsQuery } from '../../src/domain/schemas/payments.js';
import { slotsQuery } from '../../src/domain/schemas/availability.js';
import { publicBookingBody, rescheduleBody, activateBody } from '../../src/domain/schemas/public.js';

const U = '123e4567-e89b-12d3-a456-426614174000';
const U2 = '223e4567-e89b-12d3-a456-426614174000';
const FUTURE = '2030-01-01T10:00:00Z';

const fails = (schema, data, message, status = 400) =>
  assert.throws(() => parseInput(schema, data), { message, status }, JSON.stringify(data));

test('auth: normaliza (trim, minúsculas) y no recorta password — RF-12', () => {
  assert.deepEqual(
    parseInput(registerBody, { business_name: ' B ', name: ' Ana ', email: 'A@B.COM', password: ' p ' }),
    { business_name: 'B', name: 'Ana', email: 'a@b.com', password: ' p ' },
  );
});

test('auth: ausente, vacío o solo espacios → missing_fields; tipo incorrecto → invalid_body — RF-9', () => {
  const ok = { business_name: 'B', name: 'A', email: 'a@b.com', password: 'p' };
  for (const k of Object.keys(ok)) {
    fails(registerBody, { ...ok, [k]: undefined }, 'missing_fields');
    fails(registerBody, { ...ok, [k]: '' }, 'missing_fields');
    fails(registerBody, { ...ok, [k]: null }, 'missing_fields');
    fails(registerBody, { ...ok, [k]: 123 }, 'invalid_body');
  }
  fails(registerBody, { ...ok, name: '   ' }, 'missing_fields');
  fails(registerBody, { ...ok, email: {} }, 'invalid_body');
  fails(registerBody, { ...ok, password: ['a'] }, 'invalid_body');
  fails(loginBody, {}, 'missing_fields');
});

test('accounts: comisión en [0,1] o null; ausente/string → 400 — RF-4', () => {
  assert.deepEqual(parseInput(commissionBody, { commission_rate: null }), { commission_rate: null });
  assert.deepEqual(parseInput(commissionBody, { commission_rate: 0 }), { commission_rate: 0 });
  for (const v of [1.5, -0.1, '0.1', undefined]) fails(commissionBody, { commission_rate: v }, 'invalid_commission_rate');
});

test('services: duration entero > 0 y price decimal ≥ 0 — RF-9', () => {
  assert.deepEqual(parseInput(createServiceBody, { name: ' S ', duration_minutes: 30, price: 0 }), { name: 'S', duration_minutes: 30, price: 0 });
  assert.deepEqual(parseInput(priceBody, { price: '12.50' }), { price: '12.50' });
  fails(createServiceBody, { name: 'S', price: 1 }, 'missing_fields');
  fails(createServiceBody, { name: 'S', duration_minutes: 0, price: 1 }, 'missing_fields');
  fails(createServiceBody, { name: 'S', duration_minutes: 1.5, price: 1 }, 'invalid_body');
  fails(createServiceBody, { name: 'S', duration_minutes: 30 }, 'missing_fields');
  fails(createServiceBody, { name: 'S', duration_minutes: 30, price: 'abc' }, 'invalid_body');
  fails(createServiceBody, { name: 'S', duration_minutes: 30, price: -1 }, 'invalid_body');
  fails(priceBody, {}, 'missing_fields');
  assert.deepEqual(parseInput(editServiceBody, {}), {}); // RF-13: nada enviado, nada cambia
  fails(editServiceBody, { name: 5 }, 'invalid_body');
});

test('clients: orden missing_fields → email_or_phone_required → invalid_phone_format — RF-4', () => {
  fails(createClientBody, {}, 'missing_fields');
  fails(createClientBody, { name: 'A' }, 'email_or_phone_required');
  fails(createClientBody, { name: 'A', phone: '123' }, 'invalid_phone_format');
  fails(createClientBody, { name: 'A', email: 'a@b.com', notes: 5 }, 'invalid_body');
  assert.deepEqual(
    parseInput(createClientBody, { name: ' A ', email: 'A@B.com', phone: '+5491112345678', notes: ' n ', x: 1 }),
    { name: 'A', email: 'a@b.com', phone: '+5491112345678', notes: 'n' },
  );
  assert.deepEqual(parseInput(createClientBody, { name: 'A', email: 'a@b.com' }), { name: 'A', email: 'a@b.com' }); // opcionales ausentes
  fails(editClientBody, { phone: '1' }, 'invalid_phone_format');
  assert.deepEqual(parseInput(editClientBody, {}), {});
});

test('appointments panel: presencia antes que fecha; client con lista blanca — RF-4, D-P5', () => {
  fails(panelAppointmentBody, { scheduled_at: FUTURE, client_id: U }, 'missing_fields');
  fails(panelAppointmentBody, { service_id: U, scheduled_at: FUTURE }, 'missing_fields');
  fails(panelAppointmentBody, { service_id: U, scheduled_at: 'no-es-fecha' }, 'missing_fields'); // falta cliente: gana la presencia
  fails(panelAppointmentBody, { service_id: U, scheduled_at: 'no-es-fecha', client_id: U }, 'invalid_date');
  fails(panelAppointmentBody, { service_id: 'x', scheduled_at: FUTURE, client_id: U }, 'invalid_body');
  fails(panelAppointmentBody, { service_id: U, scheduled_at: [], client_id: U }, 'invalid_date');
  const out = parseInput(panelAppointmentBody, {
    service_id: U, scheduled_at: FUTURE, client: { name: 'Eve', email: 'E@T.com', account_id: 'otra' },
  });
  assert.deepEqual(out.client, { name: 'Eve', email: 'e@t.com' });
});

test('appointments block: missing_fields antes que invalid_date — RF-4', () => {
  fails(blockBody, { scheduled_at: 'x' }, 'missing_fields');
  fails(blockBody, { scheduled_at: 'x', scheduled_until: FUTURE }, 'invalid_date');
  assert.deepEqual(parseInput(blockBody, { scheduled_at: FUTURE, scheduled_until: FUTURE }), { scheduled_at: FUTURE, scheduled_until: FUTURE });
});

test('appointments edit: estricto — invalid_field / empty_update, notes admite null — RF-11', () => {
  fails(editAppointmentBody, {}, 'empty_update');
  fails(editAppointmentBody, { notes: 'x', status: 'cancelado' }, 'invalid_field');
  fails(editAppointmentBody, { scheduled_at: FUTURE }, 'invalid_field');
  for (const k of ['service_id', 'client_id', 'assigned_user_id']) {
    fails(editAppointmentBody, { [k]: null }, 'invalid_field');
    fails(editAppointmentBody, { [k]: 'no-uuid' }, 'invalid_field');
  }
  assert.deepEqual(parseInput(editAppointmentBody, { notes: null }), { notes: null });
  assert.deepEqual(parseInput(editAppointmentBody, { notes: '' }), { notes: '' });
  assert.deepEqual(parseInput(editAppointmentBody, { service_id: U }), { service_id: U });
  fails(editAppointmentBody, [], 'invalid_body');
});

test('appointments list: solo tipos string', () => {
  assert.deepEqual(parseInput(listAppointmentsQuery, { status: 'agendado', foo: 'x' }), { status: 'agendado' });
  fails(listAppointmentsQuery, { date_from: ['a', 'b'] }, 'invalid_date');
  fails(listAppointmentsQuery, { employee_id: ['a'] }, 'invalid_body');
});

test('staff: invitar con comisión 422; edición estricta; perfil propio — RF-4', () => {
  fails(inviteStaffBody, { name: 'A' }, 'missing_fields');
  fails(inviteStaffBody, { name: 'A', email: 'a@b.com', commission_rate: 2 }, 'invalid_commission_rate', 422);
  assert.deepEqual(parseInput(inviteStaffBody, { name: ' A ', email: 'A@B.com' }), { name: 'A', email: 'a@b.com' });
  assert.deepEqual(parseInput(inviteStaffBody, { name: 'A', email: 'a@b.com', commission_rate: null }).commission_rate, null);

  fails(editStaffBody, {}, 'empty_update');
  fails(editStaffBody, { role: 'owner' }, 'invalid_field');
  fails(editStaffBody, { role: 'owner', commission_rate: 2 }, 'invalid_field'); // invalid_field precede a la comisión
  fails(editStaffBody, { name: null }, 'invalid_field');
  fails(editStaffBody, { commission_rate: 2 }, 'invalid_commission_rate', 422);
  assert.deepEqual(parseInput(editStaffBody, { name: 'Ana', commission_rate: null }), { name: 'Ana', commission_rate: null });

  fails(editSelfBody, { email: 'a@b.com' }, 'invalid_field');
  fails(editSelfBody, { commission_rate: 0.5 }, 'invalid_field');
  fails(editSelfBody, {}, 'empty_update');
  assert.deepEqual(parseInput(editSelfBody, { password: ' nueva ' }), { password: ' nueva ' }); // sin recortar
});

test('staff horario: forma → 400, valores → 422, la forma completa se evalúa primero — RF-5', () => {
  const w = { day_of_week: 1, start_time: '09:00', end_time: '10:00' };
  for (const bad of [null, {}, 'x']) fails(availabilityWindowsBody, bad, 'invalid_body');
  for (const bad of [[null], ['x'], [[]]]) fails(availabilityWindowsBody, bad, 'invalid_window');
  fails(availabilityWindowsBody, [{ day_of_week: 1 }], 'missing_fields');
  fails(availabilityWindowsBody, [{ ...w, day_of_week: '1' }], 'invalid_day_of_week', 422);
  fails(availabilityWindowsBody, [{ ...w, day_of_week: 7 }], 'invalid_day_of_week', 422);
  fails(availabilityWindowsBody, [{ ...w, start_time: '9:00' }], 'invalid_time_format', 422);
  fails(availabilityWindowsBody, [{ ...w, end_time: '24:00' }], 'invalid_time_format', 422);
  fails(availabilityWindowsBody, [{ ...w, end_time: '09:00' }], 'start_must_be_before_end', 422);
  // valor inválido en la ventana 1 + forma inválida en la 2 → gana la forma (400)
  fails(availabilityWindowsBody, [{ ...w, day_of_week: 9 }, { day_of_week: 1 }], 'missing_fields');
  assert.deepEqual(parseInput(availabilityWindowsBody, [{ ...w, id: 'x' }]), [w]);
  assert.deepEqual(parseInput(availabilityWindowsBody, []), []);
});

test('payments y availability: query', () => {
  assert.deepEqual(parseInput(paymentsQuery, { period: 'hoy' }), { period: 'hoy' });
  fails(paymentsQuery, { period: ['a'] }, 'invalid_period');
  fails(slotsQuery, {}, 'date_from, date_to, service_id required');
  fails(slotsQuery, { date_from: 'a', date_to: 'b', service_id: U }, 'invalid_date');
  fails(slotsQuery, { date_from: 'a', date_to: 'b' }, 'date_from, date_to, service_id required');
  assert.equal(parseInput(slotsQuery, { date_from: '2030-01-01', date_to: '2030-01-02', service_id: U }).service_id, U);
});

test('public: booking, reprogramar y activar — RF-4, RF-9', () => {
  const ok = { account_id: U, service_id: U2, scheduled_at: FUTURE, client: { name: 'A', email: 'a@b.com' } };
  assert.equal(parseInput(publicBookingBody, ok).scheduled_at, FUTURE);
  fails(publicBookingBody, {}, 'missing_fields');
  fails(publicBookingBody, { ...ok, client: undefined }, 'client_required');
  fails(publicBookingBody, { ...ok, scheduled_at: 12345 }, 'invalid_scheduled_at');
  fails(publicBookingBody, { ...ok, scheduled_at: [] }, 'invalid_scheduled_at');
  assert.equal(parseInput(publicBookingBody, { ...ok, scheduled_at: 'x' }).scheduled_at, 'x'); // la fecha ilegible la resuelve el dominio (D-P3)
  fails(publicBookingBody, { ...ok, client: 'x' }, 'invalid_body');
  fails(publicBookingBody, { ...ok, account_id: 'no-uuid' }, 'invalid_body');
  fails(rescheduleBody, {}, 'missing_fields');
  fails(activateBody, { token: 't' }, 'missing_fields');
  assert.deepEqual(parseInput(activateBody, { token: 't', password: ' p ' }), { token: 't', password: ' p ' });
});
