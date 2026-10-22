import { test, expect } from 'vitest';
import { localDayRange, localPeriod, localRange, toDateInput } from './day';

const local = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms);

test('localDayRange cubre de 00:00:00.000 a 23:59:59.999 del día local — RF-3', () => {
  const { from, to } = localDayRange(local(2026, 3, 10, 15, 30));
  expect(new Date(from).getTime()).toBe(local(2026, 3, 10).getTime());
  expect(new Date(to).getTime()).toBe(local(2026, 3, 10, 23, 59, 59, 999).getTime());
});

test('localDayRange no se corre en un día con cambio de hora', () => {
  // en zonas con DST el día dura 23 o 25 h; los extremos siguen siendo las 00:00 y las 23:59:59.999 locales
  for (const day of [local(2026, 3, 8), local(2026, 4, 5), local(2026, 9, 6), local(2026, 10, 25)]) {
    const { from, to } = localDayRange(day);
    const a = new Date(from); const b = new Date(to);
    // en Santiago el cambio de septiembre salta de las 00:00 a las 01:00: ese día "empieza" a la 01:00 local
    expect(a.getDate()).toBe(day.getDate());
    expect(a.getHours()).toBeLessThanOrEqual(1);
    expect(a.getMinutes()).toBe(0);
    expect([b.getHours(), b.getMinutes(), b.getDate()]).toEqual([23, 59, day.getDate()]);
  }
});

test('localPeriod "hoy" es el día local', () => {
  const now = local(2026, 5, 14, 22, 10);
  expect(localPeriod('hoy', now)).toEqual(localDayRange(now));
});

test('localPeriod "esta_semana" va de lunes a domingo', () => {
  const wed = local(2026, 5, 13, 12); // miércoles
  const { from, to } = localPeriod('esta_semana', wed);
  expect(new Date(from).getTime()).toBe(local(2026, 5, 11).getTime());
  expect(new Date(to).getTime()).toBe(local(2026, 5, 17, 23, 59, 59, 999).getTime());
  const sun = local(2026, 5, 17, 9);
  expect(new Date(localPeriod('esta_semana', sun).from).getTime()).toBe(local(2026, 5, 11).getTime());
  const mon = local(2026, 5, 11, 9);
  expect(new Date(localPeriod('esta_semana', mon).to).getTime()).toBe(local(2026, 5, 17, 23, 59, 59, 999).getTime());
});

test('localPeriod "este_mes" va del 1 al último día', () => {
  const { from, to } = localPeriod('este_mes', local(2026, 2, 14, 12));
  expect(new Date(from).getTime()).toBe(local(2026, 2, 1).getTime());
  expect(new Date(to).getTime()).toBe(local(2026, 2, 28, 23, 59, 59, 999).getTime());
});

test('localRange convierte dos fechas YYYY-MM-DD a instantes locales y rechaza desde > hasta', () => {
  const r = localRange('2026-05-01', '2026-05-03');
  expect(r && new Date(r.from).getTime()).toBe(local(2026, 5, 1).getTime());
  expect(r && new Date(r.to).getTime()).toBe(local(2026, 5, 3, 23, 59, 59, 999).getTime());
  expect(localRange('2026-05-04', '2026-05-03')).toBeNull();
  expect(localRange('', '2026-05-03')).toBeNull();
  expect(localRange('2026-05-03', '2026-05-03')).not.toBeNull();
});

test('toDateInput formatea la fecha local como YYYY-MM-DD', () => {
  expect(toDateInput(local(2026, 1, 5, 23, 59))).toBe('2026-01-05');
});
