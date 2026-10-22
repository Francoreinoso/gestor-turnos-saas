import { test, expect } from 'vitest';
import { dedupeByStart, groupByDay, rangeFor } from './slots';
import type { Slot } from './publicTypes';

const slot = (employee_id: string, startsAt: Date, minutes = 60): Slot => ({
  employee_id,
  starts_at: startsAt.toISOString(),
  ends_at: new Date(startsAt.getTime() + minutes * 60000).toISOString(),
});
const at = (d: number, h: number, m = 0) => new Date(2030, 0, d, h, m, 0, 0); // enero 2030, hora local

test('dedupeByStart: dos profesionales libres en el mismo horario → un solo slot', () => {
  const out = dedupeByStart([slot('a', at(7, 9)), slot('b', at(7, 9)), slot('a', at(7, 10))]);
  expect(out.map(s => s.starts_at)).toEqual([at(7, 9).toISOString(), at(7, 10).toISOString()]);
});

test('dedupeByStart: devuelve los horarios ordenados', () => {
  const out = dedupeByStart([slot('a', at(7, 11)), slot('a', at(7, 9)), slot('b', at(6, 15))]);
  expect(out.map(s => s.starts_at)).toEqual([at(6, 15), at(7, 9), at(7, 11)].map(d => d.toISOString()));
});

test('rangeFor: 14 días desde las 00:00 locales', () => {
  const { date_from, date_to } = rangeFor(at(7, 15, 30));
  expect(new Date(date_from)).toEqual(at(7, 0));
  expect(new Date(date_to)).toEqual(at(21, 0));
});

test('rangeFor: respeta la cantidad de días pedida', () => {
  expect(new Date(rangeFor(at(7, 8), 3).date_to)).toEqual(at(10, 0));
});

test('groupByDay: devuelve un grupo por día, marca los vacíos y agrupa por día LOCAL', () => {
  const slots = [slot('a', at(8, 23, 30)), slot('a', at(7, 9)), slot('a', at(7, 10)), slot('a', at(9, 0))];
  const days = groupByDay(slots, 4, at(7, 12));

  expect(days).toHaveLength(4);
  expect(days.map(d => d.day)).toEqual(['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10']);
  expect(days.map(d => d.slots.length)).toEqual([2, 1, 1, 0]);
  expect(days.map(d => d.empty)).toEqual([false, false, false, true]);
  // 23:30 local pertenece al día 8 aunque en UTC pudiera caer en el 9.
  expect(days[1].slots[0].starts_at).toBe(at(8, 23, 30).toISOString());
  expect(days[0].slots.map(s => s.starts_at)).toEqual([at(7, 9), at(7, 10)].map(d => d.toISOString()));
});

test('groupByDay: ignora slots fuera de la ventana', () => {
  const days = groupByDay([slot('a', at(30, 9))], 3, at(7, 0));
  expect(days.every(d => d.empty)).toBe(true);
});
