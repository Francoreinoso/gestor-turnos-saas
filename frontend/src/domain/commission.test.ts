import { test, expect } from 'vitest';
import { percentToFraction, fractionToPercent } from './commission';

test('RF-10: convierte % a fracción y tolera espacios y coma decimal', () => {
  expect(percentToFraction(' 25 ')).toBe(0.25);
  expect(percentToFraction('12,5')).toBe(0.125);
  expect(percentToFraction('0')).toBe(0);
  expect(percentToFraction('100')).toBe(1);
  expect(percentToFraction('7')).toBe(0.07); // sin ruido de coma flotante
});

test('RF-12: vacío = null (la comisión de la cuenta)', () => {
  expect(percentToFraction('')).toBeNull();
  expect(percentToFraction('   ')).toBeNull();
});

test('RF-10: rechaza fuera de 0–100 y texto que no es número', () => {
  for (const bad of ['101', '-1', 'abc', '10%', '1.234', '1e2']) {
    expect(() => percentToFraction(bad), bad).toThrow('invalid_commission');
  }
});

test('fractionToPercent: la API devuelve "0.2500" (o null)', () => {
  expect(fractionToPercent('0.2500')).toBe('25');
  expect(fractionToPercent('0.1250')).toBe('12.5');
  expect(fractionToPercent(0.07)).toBe('7');
  expect(fractionToPercent(null)).toBe('');
  expect(fractionToPercent(undefined)).toBe('');
});
