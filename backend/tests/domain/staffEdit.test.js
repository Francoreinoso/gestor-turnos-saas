import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidCommissionRate,
  assertOwnerEditablePayload,
  assertSelfEditablePayload,
} from '../../src/domain/staffEdit.js';

test('assertValidCommissionRate: fuera de [0,1] → 422', () => {
  assert.throws(() => assertValidCommissionRate(1.5), { message: 'invalid_commission_rate', status: 422 });
  assert.throws(() => assertValidCommissionRate(-0.1), { message: 'invalid_commission_rate', status: 422 });
});

test('assertValidCommissionRate: null nunca es inválido', () => {
  assert.doesNotThrow(() => assertValidCommissionRate(null));
  assert.doesNotThrow(() => assertValidCommissionRate(undefined));
});

test('assertValidCommissionRate: dentro de [0,1] no lanza', () => {
  assert.doesNotThrow(() => assertValidCommissionRate(0));
  assert.doesNotThrow(() => assertValidCommissionRate(1));
  assert.doesNotThrow(() => assertValidCommissionRate(0.5));
});

test('assertOwnerEditablePayload: payload vacío → 400', () => {
  assert.throws(() => assertOwnerEditablePayload({}), { message: 'empty_update', status: 400 }); // RF-23
});

test('assertOwnerEditablePayload: campo no permitido (status/role) → 400', () => {
  assert.throws(() => assertOwnerEditablePayload({ status: 'inactivo' }), { message: 'invalid_field', status: 400 });
  assert.throws(() => assertOwnerEditablePayload({ role: 'owner' }), { message: 'invalid_field', status: 400 });
});

test('assertOwnerEditablePayload: name/email/commission_rate pasan, commission_rate admite null', () => {
  const changes = assertOwnerEditablePayload({ name: 'Ana', commission_rate: null });
  assert.deepEqual(changes, { name: 'Ana', commission_rate: null }); // RF-19
});

test('assertSelfEditablePayload: email/role/commission_rate → 400', () => {
  assert.throws(() => assertSelfEditablePayload({ email: 'a@b.com' }), { message: 'invalid_field', status: 400 }); // RF-21
  assert.throws(() => assertSelfEditablePayload({ role: 'owner' }), { message: 'invalid_field', status: 400 });
  assert.throws(() => assertSelfEditablePayload({ commission_rate: 0.5 }), { message: 'invalid_field', status: 400 });
});

test('assertSelfEditablePayload: name/password pasan', () => {
  const changes = assertSelfEditablePayload({ password: 'nueva123' });
  assert.deepEqual(changes, { password: 'nueva123' });
});
