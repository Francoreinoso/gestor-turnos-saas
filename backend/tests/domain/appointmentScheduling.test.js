import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEndsAt, resolveInitialStatus, overlaps } from '../../src/domain/appointmentScheduling.js';

test('computeEndsAt suma la duración en minutos al inicio', () => {
  const start = new Date('2026-09-01T10:00:00Z');
  assert.deepEqual(computeEndsAt(start, 90), new Date('2026-09-01T11:30:00Z'));
});

test('computeEndsAt lanza 422 con duración cero o negativa', () => {
  const start = new Date('2026-09-01T10:00:00Z');
  assert.throws(() => computeEndsAt(start, 0), { message: 'invalid_service_duration', status: 422 });
  assert.throws(() => computeEndsAt(start, -30), { message: 'invalid_service_duration', status: 422 });
  assert.throws(() => computeEndsAt(start, NaN), { message: 'invalid_service_duration', status: 422 });
});

test('resolveInitialStatus: fin pasado o igual al ahora → completado', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  assert.equal(resolveInitialStatus(new Date('2026-09-01T11:59:00Z'), now), 'completado');
  assert.equal(resolveInitialStatus(new Date('2026-09-01T12:00:00Z'), now), 'completado');
});

test('resolveInitialStatus: fin futuro → agendado', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  assert.equal(resolveInitialStatus(new Date('2026-09-01T12:00:01Z'), now), 'agendado');
});

test('overlaps: intervalos semiabiertos [inicio, fin) — adyacentes no solapan', () => {
  const a = [new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T11:00:00Z')];
  const adyacente = [new Date('2026-09-01T11:00:00Z'), new Date('2026-09-01T12:00:00Z')];
  const pisado = [new Date('2026-09-01T10:30:00Z'), new Date('2026-09-01T11:30:00Z')];
  assert.equal(overlaps(...a, ...adyacente), false);
  assert.equal(overlaps(...a, ...pisado), true);
});
