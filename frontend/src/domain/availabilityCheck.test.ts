import { test, expect } from 'vitest';
import { isWithinSchedule } from './availabilityCheck';

// 2026-05-13 es miércoles (day_of_week 3)
const at = (h: number, m = 0) => new Date(2026, 4, 13, h, m);
const wed = [{ day_of_week: 3, start_time: '09:00', end_time: '13:00' }, { day_of_week: 3, start_time: '14:00', end_time: '18:00' }];

test('dentro de un tramo', () => {
  expect(isWithinSchedule(at(10), at(11), wed)).toBe(true);
  expect(isWithinSchedule(at(9), at(13), wed)).toBe(true); // los bordes valen
});

test('fuera del horario o en la pausa', () => {
  expect(isWithinSchedule(at(8), at(9), wed)).toBe(false);
  expect(isWithinSchedule(at(13), at(14), wed)).toBe(false);
  expect(isWithinSchedule(at(12, 30), at(13, 30), wed)).toBe(false);
  expect(isWithinSchedule(at(17, 30), at(18, 30), wed)).toBe(false);
});

test('cruza dos tramos contiguos', () => {
  const contiguous = [{ day_of_week: 3, start_time: '09:00', end_time: '12:00' }, { day_of_week: 3, start_time: '12:00', end_time: '15:00' }];
  expect(isWithinSchedule(at(11), at(13), contiguous)).toBe(true);
});

test('día sin horario y turno que cruza la medianoche', () => {
  expect(isWithinSchedule(at(10), at(11), [{ day_of_week: 4, start_time: '09:00', end_time: '18:00' }])).toBe(false);
  expect(isWithinSchedule(at(10), at(11), [])).toBe(false);
  expect(isWithinSchedule(new Date(2026, 4, 13, 23), new Date(2026, 4, 14, 1), [{ day_of_week: 3, start_time: '00:00', end_time: '23:59' }])).toBe(false);
});

test('acepta horas con segundos como las devuelve la API', () => {
  expect(isWithinSchedule(at(10), at(11), [{ day_of_week: 3, start_time: '09:00:00', end_time: '18:00:00' }])).toBe(true);
});
