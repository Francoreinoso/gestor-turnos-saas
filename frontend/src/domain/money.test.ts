import { test, expect } from 'vitest';
import { parsePrice } from './money';

test('RF-5: acepta 8000, 8.000 y 1.250.000 (y un "$" inicial)', () => {
  expect(parsePrice('8000')).toBe('8000');
  expect(parsePrice('8.000')).toBe('8000');
  expect(parsePrice('1.250.000')).toBe('1250000');
  expect(parsePrice(' $8.000 ')).toBe('8000');
  expect(parsePrice('0')).toBe('0'); // precio ≥ 0
});

test('R2: rechaza decimales, negativos, texto y vacío en vez de adivinar', () => {
  for (const bad of ['8,5', '8.5', '8.50', '-100', 'abc', '', '  ', '8.00', '1.2345', '8 000']) {
    expect(() => parsePrice(bad), bad).toThrow('invalid_price');
  }
});
