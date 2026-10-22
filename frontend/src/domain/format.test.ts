import { test, expect } from 'vitest';
import { formatTime, formatDayLong, formatDateTime, formatPrice, statusLabel } from './format';

const d = new Date(2030, 0, 7, 9, 5).toISOString();

test('RF-35: la hora se muestra en es-AR en 24 h, en la zona del navegador', () => {
  expect(formatTime(d)).toBe('09:05');
});

test('RF-35: el día y la fecha completa salen en español', () => {
  expect(formatDayLong(d)).toMatch(/lunes/i);
  expect(formatDayLong(d)).toMatch(/enero/i);
  expect(formatDateTime(d)).toMatch(/lunes.*enero.*09:05/i);
});

test('formatPrice: muestra pesos con el valor del backend', () => {
  expect(formatPrice('1500.00')).toMatch(/1\.500/);
});

test('statusLabel: estados en español; desconocido no muestra el código crudo', () => {
  expect(statusLabel('agendado')).toBe('Agendado');
  expect(statusLabel('cancelado')).toBe('Cancelado');
  expect(statusLabel('no_llego')).toBe('No llegó');
  expect(statusLabel('cosa_rara')).not.toContain('cosa_rara');
});
