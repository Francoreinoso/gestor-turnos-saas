import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validatePhone, PHONE_REGEX } from '../../src/domain/client.js';

test('normalizeEmail convierte a minúsculas', () => {
  assert.equal(normalizeEmail('Usuario@EJEMPLO.com'), 'usuario@ejemplo.com');
  assert.equal(normalizeEmail('ya.minuscula@x.com'), 'ya.minuscula@x.com');
});

test('validatePhone acepta formato E.164 válido', () => {
  assert.doesNotThrow(() => validatePhone('+5491112345678'));
  assert.doesNotThrow(() => validatePhone('+1800555000'));
});

test('validatePhone lanza con formato inválido', () => {
  assert.throws(() => validatePhone('5491112345678'), { status: 400 });   // sin +
  assert.throws(() => validatePhone('+549'), { status: 400 });             // muy corto
  assert.throws(() => validatePhone('+549111234567890123'), { status: 400 }); // muy largo
});
