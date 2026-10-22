import { test, expect } from 'vitest';
import { groupByDay, flattenSchedule, validateSchedule, isDirty, emptyWeek, hasErrors } from './schedule';
import type { WeekDays } from './schedule';

const week = (patch: Record<number, [string, string][]>): WeekDays => {
  const days = emptyWeek();
  for (const [i, spans] of Object.entries(patch)) days[Number(i)] = spans.map(([start, end]) => ({ start, end }));
  return days;
};

test('R1: groupByDay muestra lunes primero y deja el domingo (0 en la API) al final', () => {
  const days = groupByDay([
    { day_of_week: 0, start_time: '10:00', end_time: '12:00' },
    { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
    { day_of_week: 6, start_time: '09:00', end_time: '11:00' },
  ]);
  expect(days).toHaveLength(7);
  expect(days[0]).toEqual([{ start: '09:00', end: '13:00' }]); // lunes
  expect(days[5]).toEqual([{ start: '09:00', end: '11:00' }]); // sábado
  expect(days[6]).toEqual([{ start: '10:00', end: '12:00' }]); // domingo
  expect(days[1]).toEqual([]);
});

test('groupByDay ordena los tramos de cada día por inicio', () => {
  const days = groupByDay([
    { day_of_week: 2, start_time: '15:00', end_time: '18:00' },
    { day_of_week: 2, start_time: '09:00', end_time: '12:00' },
  ]);
  expect(days[1].map(s => s.start)).toEqual(['09:00', '15:00']);
});

test('flattenSchedule es la inversa de groupByDay', () => {
  const windows = [
    { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
    { day_of_week: 3, start_time: '09:00', end_time: '12:00' },
    { day_of_week: 3, start_time: '15:00', end_time: '18:00' },
    { day_of_week: 0, start_time: '10:00', end_time: '12:00' },
  ];
  const flat = flattenSchedule(groupByDay(windows));
  const key = (w: { day_of_week: number; start_time: string }) => `${w.day_of_week}${w.start_time}`;
  expect(flat.sort((a, b) => key(a).localeCompare(key(b)))).toEqual([...windows].sort((a, b) => key(a).localeCompare(key(b))));
  expect(flattenSchedule(emptyWeek())).toEqual([]);
});

// Mismos casos que backend/tests/domain/availabilityWindows.test.js (D4).
test('RF-17: un tramo válido y los días vacíos no dan error', () => {
  const errors = validateSchedule(week({ 0: [['09:00', '18:00']] }));
  expect(errors).toEqual([null, null, null, null, null, null, null]);
  expect(hasErrors(errors)).toBe(false);
});

test('RF-17: inicio igual o posterior al fin → start_not_before_end', () => {
  expect(validateSchedule(week({ 2: [['10:00', '10:00']] }))[2]).toBe('start_not_before_end');
  expect(validateSchedule(week({ 2: [['18:00', '09:00']] }))[2]).toBe('start_not_before_end');
});

test('RF-17: tramos que se solapan en el mismo día → overlap, sin importar el orden en que se cargaron', () => {
  expect(validateSchedule(week({ 0: [['09:00', '12:00'], ['11:00', '14:00']] }))[0]).toBe('overlap');
  expect(validateSchedule(week({ 0: [['11:00', '14:00'], ['09:00', '12:00']] }))[0]).toBe('overlap');
  expect(validateSchedule(week({ 0: [['09:00', '18:00'], ['10:00', '11:00']] }))[0]).toBe('overlap'); // uno contiene al otro
});

test('RF-17: tramos contiguos son válidos (12:00 fin = 12:00 inicio)', () => {
  expect(validateSchedule(week({ 0: [['09:00', '12:00'], ['12:00', '15:00']] }))[0]).toBeNull();
});

test('RF-17: el mismo tramo en días distintos no se solapa', () => {
  const errors = validateSchedule(week({ 0: [['09:00', '12:00']], 1: [['09:00', '12:00']] }));
  expect(hasErrors(errors)).toBe(false);
});

test('RF-17: una hora vacía o con formato inválido → incomplete', () => {
  expect(validateSchedule(week({ 0: [['', '12:00']] }))[0]).toBe('incomplete');
  expect(validateSchedule(week({ 0: [['09:00', '25:00']] }))[0]).toBe('incomplete');
  expect(validateSchedule(week({ 0: [['9:00', '12:00']] }))[0]).toBe('incomplete');
});

test('RF-17: marca solo la fila con el problema', () => {
  const errors = validateSchedule(week({ 0: [['09:00', '12:00']], 3: [['12:00', '10:00']] }));
  expect(errors.map(e => e !== null)).toEqual([false, false, false, true, false, false, false]);
});

test('RF-19: isDirty compara el contenido, no el orden de carga', () => {
  const a = week({ 0: [['09:00', '12:00'], ['15:00', '18:00']] });
  const b = week({ 0: [['15:00', '18:00'], ['09:00', '12:00']] });
  expect(isDirty(a, b)).toBe(false);
  expect(isDirty(a, week({ 0: [['09:00', '12:00']] }))).toBe(true);
  expect(isDirty(emptyWeek(), emptyWeek())).toBe(false);
});
