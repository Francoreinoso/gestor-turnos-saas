import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuid } from '../../src/domain/uuid.js';

test('isUuid acepta un UUID válido, también en mayúsculas', () => {
  assert.equal(isUuid('3f2b8c1e-5d4a-4e6f-9a1b-0c2d3e4f5a6b'), true);
  assert.equal(isUuid('3F2B8C1E-5D4A-4E6F-9A1B-0C2D3E4F5A6B'), true);
});

test('isUuid rechaza vacío, texto, espacios, null y números', () => {
  assert.equal(isUuid(''), false);
  assert.equal(isUuid('abc'), false);
  assert.equal(isUuid(' 3f2b8c1e-5d4a-4e6f-9a1b-0c2d3e4f5a6b '), false);
  assert.equal(isUuid('3f2b8c1e-5d4a-4e6f-9a1b-0c2d3e4f5a6'), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(123), false);
});
