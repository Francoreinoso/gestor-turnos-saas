import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod } from '../../src/domain/paymentsPeriod.js';

// RF-14: límites exactos de cada preset, en UTC.
test('preset hoy: 00:00:00.000 a 23:59:59.999 UTC del día actual', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  const { from, to } = resolvePeriod({ preset: 'hoy', now });
  assert.deepEqual(from, new Date('2026-09-17T00:00:00.000Z'));
  assert.deepEqual(to, new Date('2026-09-17T23:59:59.999Z'));
});

test('preset esta_semana: lunes 00:00:00.000 a domingo 23:59:59.999 UTC — now un jueves', () => {
  const now = new Date('2026-09-17T15:30:00Z'); // jueves
  const { from, to } = resolvePeriod({ preset: 'esta_semana', now });
  assert.deepEqual(from, new Date('2026-09-14T00:00:00.000Z')); // lunes
  assert.deepEqual(to, new Date('2026-09-20T23:59:59.999Z')); // domingo
});

test('preset esta_semana: now un domingo cae en la misma semana (lunes anterior)', () => {
  const now = new Date('2026-09-20T23:59:59.999Z'); // domingo, último instante
  const { from, to } = resolvePeriod({ preset: 'esta_semana', now });
  assert.deepEqual(from, new Date('2026-09-14T00:00:00.000Z'));
  assert.deepEqual(to, new Date('2026-09-20T23:59:59.999Z'));
});

test('preset esta_semana: now un lunes a las 00:00:00.000 es el propio borde', () => {
  const now = new Date('2026-09-14T00:00:00.000Z'); // lunes, primer instante
  const { from, to } = resolvePeriod({ preset: 'esta_semana', now });
  assert.deepEqual(from, new Date('2026-09-14T00:00:00.000Z'));
  assert.deepEqual(to, new Date('2026-09-20T23:59:59.999Z'));
});

test('preset este_mes: primer día 00:00:00.000 a último día 23:59:59.999 UTC', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  const { from, to } = resolvePeriod({ preset: 'este_mes', now });
  assert.deepEqual(from, new Date('2026-09-01T00:00:00.000Z'));
  assert.deepEqual(to, new Date('2026-09-30T23:59:59.999Z'));
});

// RF-12: sin ningún filtro de período → este_mes por defecto.
test('sin preset ni rango libre → este_mes por defecto', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  const { from, to } = resolvePeriod({ now });
  assert.deepEqual(from, new Date('2026-09-01T00:00:00.000Z'));
  assert.deepEqual(to, new Date('2026-09-30T23:59:59.999Z'));
});

// RF-15: rango libre — límites inclusivos, se devuelven tal cual.
test('rango libre válido se devuelve tal cual (inclusive)', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  const { from, to } = resolvePeriod({ dateFrom: '2026-01-01T00:00:00Z', dateTo: '2026-01-31T23:59:59Z', now });
  assert.deepEqual(from, new Date('2026-01-01T00:00:00Z'));
  assert.deepEqual(to, new Date('2026-01-31T23:59:59Z'));
});

// RF-13: preset y rango libre juntos → 400, ambiguo.
test('preset y rango libre juntos → 400 ambiguous_period_filter', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  assert.throws(
    () => resolvePeriod({ preset: 'hoy', dateFrom: '2026-01-01T00:00:00Z', now }),
    { message: 'ambiguous_period_filter', status: 400 },
  );
});

// RF-18: preset no reconocido, o fechas no parseables → 400.
test('preset no reconocido → 400 invalid_period', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  assert.throws(
    () => resolvePeriod({ preset: 'este_anio', now }),
    { message: 'invalid_period', status: 400 },
  );
});

test('date_from o date_to no parseables → 400 invalid_period', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  assert.throws(
    () => resolvePeriod({ dateFrom: 'ayer', dateTo: '2026-01-31T23:59:59Z', now }),
    { message: 'invalid_period', status: 400 },
  );
  assert.throws(
    () => resolvePeriod({ dateFrom: '2026-01-01T00:00:00Z', dateTo: 'mañana', now }),
    { message: 'invalid_period', status: 400 },
  );
});

// RF-17: date_from posterior a date_to — NO lanza, se devuelve tal cual (D-P3 del plan).
test('date_from > date_to no lanza — se devuelve el rango invertido tal cual', () => {
  const now = new Date('2026-09-17T15:30:00Z');
  const { from, to } = resolvePeriod({ dateFrom: '2026-09-10T00:00:00Z', dateTo: '2026-09-01T00:00:00Z', now });
  assert.deepEqual(from, new Date('2026-09-10T00:00:00Z'));
  assert.deepEqual(to, new Date('2026-09-01T00:00:00Z'));
});
