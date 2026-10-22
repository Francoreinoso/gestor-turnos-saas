import { test, expect } from 'vitest';
import { publicErrorMessage } from './errors';

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
