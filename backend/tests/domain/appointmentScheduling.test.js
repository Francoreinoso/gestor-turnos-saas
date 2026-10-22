import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEndsAt, resolveInitialStatus, overlaps, assertCorrectionWindow, assertScheduledAtNotPast } from '../../src/domain/appointmentScheduling.js';

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

// spec 003 RF-19/RF-20 — ventana de corrección completado↔no_llego: hasta el
// día calendario UTC siguiente al del turno, en ambos sentidos.
test('assertCorrectionWindow: mismo día del turno → no lanza', () => {
  const scheduledAt = new Date('2026-09-17T10:00:00Z');
  assert.doesNotThrow(() => assertCorrectionWindow(scheduledAt, new Date('2026-09-17T23:00:00Z')));
});

test('assertCorrectionWindow: día calendario siguiente, hasta el último milisegundo → no lanza', () => {
  const scheduledAt = new Date('2026-09-17T10:00:00Z');
  assert.doesNotThrow(() => assertCorrectionWindow(scheduledAt, new Date('2026-09-18T23:59:59.999Z')));
});

test('assertCorrectionWindow: un milisegundo después de la ventana → 422', () => {
  const scheduledAt = new Date('2026-09-17T10:00:00Z');
  assert.throws(
    () => assertCorrectionWindow(scheduledAt, new Date('2026-09-19T00:00:00.000Z')),
    { message: 'correction_window_expired', status: 422 },
  );
});

test('assertCorrectionWindow: tres días después → 422', () => {
  const scheduledAt = new Date('2026-09-17T10:00:00Z');
  assert.throws(
    () => assertCorrectionWindow(scheduledAt, new Date('2026-09-20T10:00:00Z')),
    { message: 'correction_window_expired', status: 422 },
  );
});

// spec 005 RF-10 / RF-10b
test('assertScheduledAtNotPast: inicio pasado o igual a now → 422 appointment_in_past', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  assert.throws(() => assertScheduledAtNotPast('2026-09-01T11:59:00Z', now), { message: 'appointment_in_past', status: 422 });
  assert.throws(() => assertScheduledAtNotPast('2026-09-01T12:00:00Z', now), { message: 'appointment_in_past', status: 422 });
});

test('assertScheduledAtNotPast: futuro → devuelve el Date parseado (string o Date)', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  assert.deepEqual(assertScheduledAtNotPast('2026-09-01T12:01:00Z', now), new Date('2026-09-01T12:01:00Z'));
  const d = new Date('2026-09-02T10:00:00Z');
  assert.deepEqual(assertScheduledAtNotPast(d, now), d);
});

test('assertScheduledAtNotPast: valor que no es un instante ISO válido → 400 invalid_scheduled_at', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  for (const bad of ['x', '', null, undefined, 123, {}, new Date('nope')]) {
    assert.throws(() => assertScheduledAtNotPast(bad, now), { message: 'invalid_scheduled_at', status: 400 });
  }
});
