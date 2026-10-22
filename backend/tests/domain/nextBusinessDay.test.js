import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBusinessDay, prevBusinessDay } from '../../db/seed.js';

// spec 006 RF-28 — fechas del seed: siempre días hábiles (lunes a viernes) en hora local.
const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

// 2026-10-21 es miércoles; 2026-10-23 viernes; 2026-10-24 sábado; 2026-10-25 domingo.
test('nextBusinessDay: un miércoles con k=1 → jueves', () => {
  assert.deepEqual(ymd(nextBusinessDay(local(2026, 10, 21), 1)), [2026, 10, 22]);
});

test('nextBusinessDay: un viernes con k=1 → lunes', () => {
  assert.deepEqual(ymd(nextBusinessDay(local(2026, 10, 23), 1)), [2026, 10, 26]);
});

test('nextBusinessDay: sábado y domingo con k=1 → lunes', () => {
  assert.deepEqual(ymd(nextBusinessDay(local(2026, 10, 24), 1)), [2026, 10, 26]);
  assert.deepEqual(ymd(nextBusinessDay(local(2026, 10, 25), 1)), [2026, 10, 26]);
});

test('nextBusinessDay: k consecutivos son días hábiles distintos y crecientes, nunca el de now', () => {
  for (const now of [local(2026, 10, 21), local(2026, 10, 23), local(2026, 10, 25)]) {
    let prev = new Date(now).setHours(0, 0, 0, 0);
    for (let k = 1; k <= 8; k++) {
      const d = nextBusinessDay(now, k);
      assert.ok(d.getDay() >= 1 && d.getDay() <= 5, 'día hábil');
      assert.ok(d.getTime() > prev, 'estrictamente creciente');
      prev = d.getTime();
    }
  }
});

test('nextBusinessDay: now a las 23:59 no devuelve el mismo día', () => {
  assert.deepEqual(ymd(nextBusinessDay(local(2026, 10, 21, 23, 59), 1)), [2026, 10, 22]);
});

test('nextBusinessDay devuelve medianoche local', () => {
  const d = nextBusinessDay(local(2026, 10, 21), 2);
  assert.deepEqual([d.getHours(), d.getMinutes(), d.getSeconds()], [0, 0, 0]);
});

test('prevBusinessDay: un lunes con k=1 → viernes; nunca el día de now', () => {
  assert.deepEqual(ymd(prevBusinessDay(local(2026, 10, 26), 1)), [2026, 10, 23]);
  assert.deepEqual(ymd(prevBusinessDay(local(2026, 10, 24), 1)), [2026, 10, 23]);
  assert.deepEqual(ymd(prevBusinessDay(local(2026, 10, 21, 0, 1), 1)), [2026, 10, 20]);
});
