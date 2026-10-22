import { test, expect } from 'vitest';
import { publicErrorMessage, managementErrorMessage } from './errors';

const KNOWN = [
  'appointment_overlap', 'no_professional_available', 'appointment_in_past', 'token_expired', 'unauthorized',
  'too_many_requests', 'invalid_status_transition', 'not_found', 'missing_fields', 'client_required',
  'service_not_found', 'invalid_scheduled_at',
];

test('cada código conocido da un mensaje en español, nunca el código crudo', () => {
  for (const code of KNOWN) {
    const msg = publicErrorMessage(code);
    expect(msg, code).toBeTruthy();
    expect(msg, code).not.toContain(code);
    expect(msg, code).not.toMatch(/_/);
  }
});

test('un código desconocido da el mensaje genérico, nunca el código', () => {
  const msg = publicErrorMessage('algo_raro_del_servidor');
  expect(msg).not.toContain('algo_raro');
  expect(msg).toBe(publicErrorMessage('otro_codigo_distinto'));
});

test('sin código (undefined/vacío) también da el genérico', () => {
  expect(publicErrorMessage(undefined)).toBe(publicErrorMessage('xyz'));
  expect(publicErrorMessage('')).toBe(publicErrorMessage('xyz'));
});

test('los conflictos de horario explican que el horario ya no está disponible', () => {
  expect(publicErrorMessage('appointment_overlap')).toMatch(/disponible/i);
  expect(publicErrorMessage('no_professional_available')).toMatch(/disponible/i);
});

// ─── spec 009 RF-8 · errores de las pantallas de gestión ────────────────────

const MANAGEMENT_CODES = [
  'email_taken', 'invalid_commission', 'invalid_field', 'invalid_body', 'missing_fields', 'invalid_window',
  'invalid_time_format', 'invalid_day_of_week', 'start_must_be_before_end', 'overlapping_windows',
  'invalid_status_transition', 'invalid_password', 'forbidden', 'not_found', 'network_error', 'too_many_requests',
  'invalid_commission_rate', 'invalid_availability', 'user_inactive', 'unauthorized',
];

// Formas de voseo (tenés, elegí, esperá…): la interfaz usa tuteo (commit dc46a49).
const VOSEO = /(?<![\p{L}])(tenés|podés|querés|sos|hacé|esperá|elegí|ingresá|revisá|volvé|mirá|intentá|probá|completá|guardá|copiá|escribí|pedí|vos)(?![\p{L}])/iu;

test('RF-8: cada código del panel da un mensaje en español, sin código crudo ni guiones bajos', () => {
  for (const code of MANAGEMENT_CODES) {
    const msg = managementErrorMessage(code);
    expect(msg, code).not.toBe(managementErrorMessage('codigo_inexistente'));
    expect(msg, code).not.toMatch(/_/);
  }
});

test('RF-8, RF-26: ningún mensaje del panel usa voseo', () => {
  for (const code of [...MANAGEMENT_CODES, 'desconocido']) expect(managementErrorMessage(code), code).not.toMatch(VOSEO);
});

test('RF-8: desconocido, vacío o ausente → mensaje genérico', () => {
  const generic = managementErrorMessage('algo_raro');
  expect(generic).not.toContain('algo_raro');
  expect(managementErrorMessage(undefined)).toBe(generic);
  expect(managementErrorMessage('')).toBe(generic);
});

test('RF-10: email_taken dice "ese email ya está en uso"', () => {
  expect(managementErrorMessage('email_taken')).toMatch(/ese email ya está en uso/i);
});
