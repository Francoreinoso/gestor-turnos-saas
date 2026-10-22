import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, PHONE_REGEX } from '../../src/domain/client.js';

test('normalizeEmail convierte a minúsculas', () => {
  assert.equal(normalizeEmail('Usuario@EJEMPLO.com'), 'usuario@ejemplo.com');
  assert.equal(normalizeEmail('ya.minuscula@x.com'), 'ya.minuscula@x.com');
});
