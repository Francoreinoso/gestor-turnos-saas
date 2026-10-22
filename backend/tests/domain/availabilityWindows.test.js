import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeToMinutes, formatTime, normalizeWindows } from '../../src/domain/availabilityWindows.js';

const w = (day_of_week, start_time, end_time) => ({ day_of_week, start_time, end_time });

// T01 — horas y formato (RF-2, RF-7)
test('timeToMinutes: HH:MM válido', () => {
  assert.equal(timeToMinutes('09:00'), 540);
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('23:59'), 1439);
});

test('timeToMinutes: formato inválido → 422', () => {
  for (const bad of ['24:00', '9:00', '09:00:00', '09:60', 'abc', '', null, 900]) {
    assert.throws(() => timeToMinutes(bad), { status: 422 }, String(bad)); // RF-7
  }
});

test('formatTime: normaliza HH:MM:SS de la base a HH:MM', () => {
  assert.equal(formatTime('09:00:00'), '09:00');
  assert.equal(formatTime('09:00'), '09:00');
});

// T02 — forma y valores (RF-4, RF-5, RF-6, RF-8)
test('forma inválida → 400', () => {
  const bad = [
    null, undefined, {}, 'x',
    [null], ['x'], [[]],
    [{ start_time: '09:00', end_time: '10:00' }],
    [{ day_of_week: 1, end_time: '10:00' }],
    [{ day_of_week: 1, start_time: '09:00' }],
  ];
  for (const body of bad) assert.throws(() => normalizeWindows(body), { status: 400 }, JSON.stringify(body)); // RF-5
});

test('day_of_week fuera de rango o de tipo incorrecto → 422', () => {
  for (const d of ['1', 1.5, 7, -1, NaN, true]) {
    assert.throws(() => normalizeWindows([w(d, '09:00', '10:00')]), { status: 422 }, String(d)); // RF-6
  }
});

test('hora inválida → 422', () => {
  assert.throws(() => normalizeWindows([w(1, '9:00', '10:00')]), { status: 422 }); // RF-7
  assert.throws(() => normalizeWindows([w(1, '09:00', '24:00')]), { status: 422 });
});

test('start >= end → 422', () => {
  assert.throws(() => normalizeWindows([w(1, '10:00', '10:00')]), { status: 422 }); // RF-8
  assert.throws(() => normalizeWindows([w(1, '18:00', '09:00')]), { status: 422 });
});

test('lista vacía → []', () => {
  assert.deepEqual(normalizeWindows([]), []); // RF-4
});

test('resultado ordenado por día e inicio y con horas HH:MM', () => {
  const out = normalizeWindows([w(3, '15:00', '19:00'), w(1, '09:00', '13:00'), w(3, '09:00', '13:00')]);
  assert.deepEqual(out, [w(1, '09:00', '13:00'), w(3, '09:00', '13:00'), w(3, '15:00', '19:00')]);
});

test('ignora campos extra de cada ventana', () => {
  const [out] = normalizeWindows([{ ...w(2, '08:00', '12:00'), id: 'x', user_id: 'y' }]);
  assert.deepEqual(out, w(2, '08:00', '12:00'));
});

// T03 — solapamiento (RF-9)
test('ventanas solapadas el mismo día → 422', () => {
  assert.throws(() => normalizeWindows([w(1, '09:00', '13:00'), w(1, '12:00', '15:00')]), { status: 422 });
  assert.throws(() => normalizeWindows([w(1, '09:00', '17:00'), w(1, '10:00', '11:00')]), { status: 422 }); // contenida
});

test('ventanas idénticas repetidas → 422', () => {
  assert.throws(() => normalizeWindows([w(1, '09:00', '13:00'), w(1, '09:00', '13:00')]), { status: 422 });
});

test('adyacentes, dos tramos y días distintos son válidos', () => {
  assert.equal(normalizeWindows([w(1, '09:00', '13:00'), w(1, '13:00', '17:00')]).length, 2); // fin = inicio no solapa
  assert.equal(normalizeWindows([w(1, '09:00', '13:00'), w(1, '15:00', '19:00')]).length, 2);
  assert.equal(normalizeWindows([w(1, '09:00', '13:00'), w(2, '09:00', '13:00')]).length, 2);
});

test('ventana contenida y otra posterior → 422', () => {
  // 10-11 está contenida en 09-17
  assert.throws(
    () => normalizeWindows([w(1, '09:00', '17:00'), w(1, '10:00', '11:00'), w(1, '12:00', '13:00')]),
    { status: 422 },
  );
});
