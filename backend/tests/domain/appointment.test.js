import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition } from '../../src/domain/appointment.js';

test('transiciones válidas', () => {
  assert.ok(canTransition('agendado', 'cancelado'));
  assert.ok(canTransition('en_progreso', 'no_llego'));
  assert.ok(canTransition('completado', 'no_llego'));
  assert.ok(canTransition('no_llego', 'completado'));
});

test('transiciones inválidas', () => {
  assert.equal(canTransition('cancelado', 'agendado'), false);
  assert.equal(canTransition('completado', 'agendado'), false);
  assert.equal(canTransition('bloqueado', 'agendado'), false);
  assert.equal(canTransition('agendado', 'completado'), false);
});

test('assertTransition lanza en transición inválida', () => {
  assert.throws(
    () => assertTransition('cancelado', 'agendado'),
    { message: 'invalid_status_transition', status: 422 }
  );
});

test('assertTransition no lanza en transición válida', () => {
  assert.doesNotThrow(() => assertTransition('agendado', 'cancelado'));
});
