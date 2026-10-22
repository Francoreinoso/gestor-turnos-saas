import { test, expect } from 'vitest';
import { availableActions, isCorrectable } from './appointmentActions';
import type { Appointment, AppointmentStatus } from './types';

const appt = (status: AppointmentStatus, over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', account_id: 'acc', client_id: 'c1', service_id: 's1', assigned_user_id: 'u1',
  scheduled_at: '2026-09-17T10:00:00Z', scheduled_until: '2026-09-17T11:00:00Z', status, notes: null, ...over,
});
const owner = { id: 'o1', role: 'owner' as const };
const staff = { id: 'u1', role: 'staff' as const };
const other = { id: 'u2', role: 'staff' as const };
const sameDay = new Date('2026-09-17T12:00:00Z');

test('isCorrectable: hasta 23:59:59.999 UTC del día siguiente, un milisegundo más ya no — RF-17', () => {
  expect(isCorrectable('2026-09-17T10:00:00Z', new Date('2026-09-17T23:00:00Z'))).toBe(true);
  expect(isCorrectable('2026-09-17T10:00:00Z', new Date('2026-09-18T23:59:59.999Z'))).toBe(true);
  expect(isCorrectable('2026-09-17T10:00:00Z', new Date('2026-09-19T00:00:00.000Z'))).toBe(false);
  expect(isCorrectable('2026-09-17T10:00:00Z', new Date('2026-09-20T10:00:00Z'))).toBe(false);
});

test('agendado: editar y cancelar; nada de corregir — RF-13, RF-19', () => {
  expect(availableActions(appt('agendado'), owner, sameDay)).toEqual(['edit', 'cancel']);
  expect(availableActions(appt('agendado'), staff, sameDay)).toEqual(['edit', 'cancel']);
});

test('completado ofrece "no llegó" y no_llego ofrece "completado", solo dentro de la ventana — RF-17', () => {
  expect(availableActions(appt('completado'), owner, sameDay)).toEqual(['markNoShow']);
  expect(availableActions(appt('no_llego'), owner, sameDay)).toEqual(['markCompleted']);
  const late = new Date('2026-09-20T10:00:00Z');
  expect(availableActions(appt('completado'), owner, late)).toEqual([]);
  expect(availableActions(appt('no_llego'), owner, late)).toEqual([]);
});

test('bloqueado ofrece cancelar el bloqueo', () => {
  expect(availableActions(appt('bloqueado', { client_id: null }), owner, sameDay)).toEqual(['cancelBlock']);
});

test('cancelado y en_progreso no ofrecen nada', () => {
  expect(availableActions(appt('cancelado'), owner, sameDay)).toEqual([]);
  expect(availableActions(appt('en_progreso'), owner, sameDay)).toEqual([]);
});

test('un staff no tiene acciones sobre turnos o bloqueos ajenos — D7', () => {
  expect(availableActions(appt('agendado'), other, sameDay)).toEqual([]);
  expect(availableActions(appt('completado'), other, sameDay)).toEqual([]);
  expect(availableActions(appt('bloqueado', { assigned_user_id: null }), staff, sameDay)).toEqual([]);
  expect(availableActions(appt('bloqueado', { assigned_user_id: null }), owner, sameDay)).toEqual(['cancelBlock']);
});
