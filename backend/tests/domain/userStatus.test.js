import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition } from '../../src/domain/userStatus.js';

test('transiciones válidas', () => {
  assert.ok(canTransition('pendiente', 'activo')); // RF-11
  assert.ok(canTransition('pendiente', 'inactivo')); // RF-25
  assert.ok(canTransition('activo', 'inactivo')); // RF-25
  assert.ok(canTransition('inactivo', 'pendiente')); // RF-7
});

test('transiciones inválidas', () => {
  assert.equal(canTransition('inactivo', 'activo'), false);
  assert.equal(canTransition('activo', 'pendiente'), false);
});

test('assertTransition lanza 422 en transición inválida', () => {
  assert.throws(
    () => assertTransition('inactivo', 'activo'),
    { message: 'invalid_status_transition', status: 422 } // RF-28
  );
});

test('assertTransition no lanza en transición válida', () => {
  assert.doesNotThrow(() => assertTransition('activo', 'inactivo'));
});
