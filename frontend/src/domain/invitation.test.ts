import { test, expect } from 'vitest';
import { readActivationToken, INVITATION_NOTICE } from './invitation';

test('RF-23: lee el token de la query', () => {
  expect(readActivationToken('?token=abc')).toBe('abc');
  expect(readActivationToken('?x=1&token=a%20b')).toBe('a b');
});

test('RF-24: sin token, vacío o sin query → null', () => {
  expect(readActivationToken('')).toBeNull();
  expect(readActivationToken('?token=')).toBeNull();
  expect(readActivationToken('?otro=1')).toBeNull();
});

test('RF-11: el aviso dice que no se envían emails y que vence en 72 horas', () => {
  expect(INVITATION_NOTICE).toMatch(/Aún no enviamos emails/);
  expect(INVITATION_NOTICE).toMatch(/72 horas/);
});
