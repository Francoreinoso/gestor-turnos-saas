import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommission } from '../../src/domain/resolveCommission.js';

test('sin comisión — ambos null', () => {
  const r = resolveCommission('100.00', null, null);
  assert.deepEqual(r, { rate: null, employeeAmount: null, businessAmount: null });
});

test('sin comisión — undefined equivale a null', () => {
  const r = resolveCommission('100.00', undefined, undefined);
  assert.deepEqual(r, { rate: null, employeeAmount: null, businessAmount: null });
});

test('rate de account cuando user no tiene', () => {
  const r = resolveCommission('100.00', null, '0.3000');
  assert.equal(r.rate, '0.3000');
  assert.equal(r.employeeAmount, '30.00');
  assert.equal(r.businessAmount, '70.00');
});

test('rate de user pisa account', () => {
  const r = resolveCommission('100.00', '0.6000', '0.3000');
  assert.equal(r.rate, '0.6000');
  assert.equal(r.employeeAmount, '60.00');
  assert.equal(r.businessAmount, '40.00');
});

test('rate 0 — todo va al negocio', () => {
  const r = resolveCommission('100.00', '0.0000', null);
  assert.equal(r.employeeAmount, '0.00');
  assert.equal(r.businessAmount, '100.00');
});

test('rate 1 — todo va al empleado', () => {
  const r = resolveCommission('100.00', '1.0000', null);
  assert.equal(r.employeeAmount, '100.00');
  assert.equal(r.businessAmount, '0.00');
});

test('redondeo — employee + business = amount exacto', () => {
  // 33.33 * 0.3333 = 11.10... — verifica que no se pierdan centavos
  const r = resolveCommission('33.33', '0.3333', null);
  const total = (Number(r.employeeAmount) + Number(r.businessAmount)).toFixed(2);
  assert.equal(total, '33.33');
});
