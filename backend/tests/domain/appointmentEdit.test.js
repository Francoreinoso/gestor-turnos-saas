import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertEditablePayload } from '../../src/domain/appointmentEdit.js';

test('devuelve solo los campos editables presentes', () => {
  const changes = assertEditablePayload({ notes: 'hola', service_id: 'svc-2' });
  assert.deepEqual(changes, { notes: 'hola', service_id: 'svc-2' });
});

test('notes admite null y cadena vacía para limpiarse (RF-20)', () => {
  assert.deepEqual(assertEditablePayload({ notes: null }), { notes: null });
  assert.deepEqual(assertEditablePayload({ notes: '' }), { notes: '' });
});

test('lanza 400 si no hay ningún campo editable (RF-21)', () => {
  assert.throws(() => assertEditablePayload({}), { message: 'empty_update', status: 400 });
});

test('lanza 400 si aparece un campo no editable (RF-22)', () => {
  assert.throws(() => assertEditablePayload({ notes: 'x', status: 'cancelado' }), { message: 'invalid_field', status: 400 });
  assert.throws(() => assertEditablePayload({ scheduled_at: '2026-01-01T00:00:00Z' }), { message: 'invalid_field', status: 400 });
});

test('lanza 400 si un campo de referencia viene null', () => {
  assert.throws(() => assertEditablePayload({ service_id: null }), { message: 'invalid_field', status: 400 });
  assert.throws(() => assertEditablePayload({ client_id: null }), { message: 'invalid_field', status: 400 });
  assert.throws(() => assertEditablePayload({ assigned_user_id: null }), { message: 'invalid_field', status: 400 });
});
