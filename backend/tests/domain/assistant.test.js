// spec 011 — reglas puras del asistente y esquemas de las herramientas (RF-6, RF-8, RF-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../../src/domain/validation.js';
import {
  verDisponibilidadInput, proponerReservaInput, cancelarTurnoInput, listarServiciosInput,
  startSessionBody, verifySessionBody, messageBody, parseDay, daysInclusive,
} from '../../src/domain/schemas/assistant.js';
import { findIssuedSlot, localIsoWithOffset, dayRangeToInterval, isExpired, proposalExpiresAt } from '../../src/domain/assistant.js';

const U = '123e4567-e89b-12d3-a456-426614174000';
const fails = (schema, data, message, status = 400) =>
  assert.throws(() => parseInput(schema, data), { message, status }, JSON.stringify(data));

test('ver_disponibilidad: rango de 1 a 14 días, fechas YYYY-MM-DD reales — RF-6', () => {
  assert.deepEqual(parseInput(verDisponibilidadInput, { servicio_id: U, desde: '2026-10-25', hasta: '2026-10-25' }),
    { servicio_id: U, desde: '2026-10-25', hasta: '2026-10-25' });
  assert.ok(parseInput(verDisponibilidadInput, { servicio_id: U, desde: '2026-10-25', hasta: '2026-11-07' }), '14 días');
  fails(verDisponibilidadInput, { servicio_id: U, desde: '2026-10-25', hasta: '2026-11-08' }, 'range_too_long');
  fails(verDisponibilidadInput, { servicio_id: U, desde: '2026-10-25', hasta: '2026-10-24' }, 'invalid_range');
  fails(verDisponibilidadInput, { servicio_id: U, desde: '2026-02-30', hasta: '2026-03-01' }, 'invalid_date');
  fails(verDisponibilidadInput, { servicio_id: U, desde: '25/10/2026', hasta: '2026-10-26' }, 'invalid_date');
  fails(verDisponibilidadInput, { servicio_id: 'corte', desde: '2026-10-25', hasta: '2026-10-26' }, 'invalid_input');
  fails(verDisponibilidadInput, { desde: '2026-10-25', hasta: '2026-10-26' }, 'invalid_input');
});

test('las herramientas rechazan claves extra: el modelo no puede pasar account_id ni client_id — RF-10', () => {
  fails(listarServiciosInput, { account_id: U }, 'invalid_input');
  fails(verDisponibilidadInput, { servicio_id: U, desde: '2026-10-25', hasta: '2026-10-26', client_id: U }, 'invalid_input');
  fails(proponerReservaInput, { servicio_id: U, slot_id: 's_1', client_id: U }, 'invalid_input');
  fails(cancelarTurnoInput, { turno_id: U, account_id: U }, 'invalid_input');
  fails(cancelarTurnoInput, { turno_id: 'abc' }, 'invalid_input');
  fails(proponerReservaInput, { servicio_id: U, slot_id: '' }, 'invalid_input');
  fails(listarServiciosInput, 'texto', 'invalid_input');
});

test('parseDay y daysInclusive no dependen de la zona horaria', () => {
  assert.deepEqual(parseDay('2026-03-01'), { y: 2026, m: 3, d: 1 });
  assert.equal(parseDay('2026-13-01'), null);
  assert.equal(daysInclusive(parseDay('2026-10-01'), parseDay('2026-10-14')), 14);
  assert.equal(daysInclusive(parseDay('2026-10-02'), parseDay('2026-10-01')), 0);
});

test('dayRangeToInterval: de medianoche local del primer día a medianoche local del día siguiente al último', () => {
  const { from, to } = dayRangeToInterval(parseDay('2026-10-30'), parseDay('2026-10-31'));
  assert.deepEqual([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()], [2026, 9, 30, 0]);
  assert.deepEqual([to.getFullYear(), to.getMonth(), to.getDate(), to.getHours()], [2026, 10, 1, 0]);
});

test('localIsoWithOffset representa el mismo instante en hora local', () => {
  const d = new Date(2026, 9, 25, 10, 30);
  const iso = localIsoWithOffset(d);
  assert.match(iso, /^2026-10-25T10:30:00[+-]\d{2}:\d{2}$/);
  assert.equal(new Date(iso).getTime(), d.getTime());
});

test('propuesta: vence a los 10 minutos — RF-8', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const expiresAt = proposalExpiresAt(now);
  assert.equal(expiresAt.getTime() - now.getTime(), 10 * 60 * 1000);
  assert.equal(isExpired({ expires_at: expiresAt }, new Date(expiresAt.getTime() - 1)), false);
  assert.equal(isExpired({ expires_at: expiresAt }, expiresAt), true);
});

const history = (result, { name = 'ver_disponibilidad', isError = false } = {}) => [
  { role: 'user', content: [{ type: 'text', text: 'hola' }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) }] },
];

test('findIssuedSlot: solo reconoce slots emitidos por ver_disponibilidad en el historial — RF-6, RF-8', () => {
  const result = { servicio_id: U, horarios: [{ slot_id: 's_abc', inicio: '2026-10-25T10:00:00-03:00', profesional_id: 'p1' }] };

  assert.deepEqual(findIssuedSlot(history(result), 's_abc'),
    { serviceId: U, employeeId: 'p1', startsAt: new Date('2026-10-25T13:00:00Z') });
  assert.equal(findIssuedSlot(history(result), 's_otro'), null, 'slot inventado');
  assert.equal(findIssuedSlot(history(result, { name: 'ver_mis_turnos' }), 's_abc'), null, 'otra herramienta');
  assert.equal(findIssuedSlot(history(result, { isError: true }), 's_abc'), null, 'resultado con error');
  assert.equal(findIssuedSlot([{ role: 'user', content: 's_abc' }], 's_abc'), null, 'texto del usuario');
});

test('rutas: teléfono E.164, código de 6 dígitos y mensaje acotado — RF-1, RF-3', () => {
  assert.deepEqual(parseInput(startSessionBody, { account_id: U, phone: '+56911112222' }), { account_id: U, phone: '+56911112222' });
  fails(startSessionBody, { account_id: U, phone: '911112222' }, 'invalid_phone_format');
  fails(startSessionBody, { account_id: 'x', phone: '+56911112222' }, 'not_found', 404);
  fails(verifySessionBody, { account_id: U, phone: '+56911112222', code: '12345' }, 'invalid_code', 401);
  assert.equal(parseInput(messageBody, { message: '  hola ' }).message, 'hola');
  fails(messageBody, { message: '   ' }, 'missing_fields');
  fails(messageBody, { message: 'x'.repeat(2001) }, 'message_too_long');
});
