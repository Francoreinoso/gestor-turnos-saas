import { test, expect } from 'vitest';
import {
  buildPanelAppointment, validateAppointmentForm, clientMatches, validateBlock, buildBlock, toLocalIso,
  type AppointmentFormValues,
} from './appointmentForm';

const base: AppointmentFormValues = {
  serviceId: 's1', date: '2026-05-14', time: '15:30', clientId: 'c1',
  newClient: { name: '', email: '', phone: '' }, employeeId: '', notes: '',
};

test('toLocalIso interpreta fecha y hora en la zona del navegador', () => {
  expect(toLocalIso('2026-05-14', '15:30')).toBe(new Date(2026, 4, 14, 15, 30).toISOString());
  expect(toLocalIso('', '15:30')).toBeNull();
  expect(toLocalIso('2026-05-14', '')).toBeNull();
});

test('cuerpo con cliente existente: client_id y sin client — RF-8', () => {
  const body = buildPanelAppointment(base, 'owner');
  expect(body).toEqual({ service_id: 's1', scheduled_at: toLocalIso('2026-05-14', '15:30'), client_id: 'c1' });
});

test('cuerpo con cliente nuevo: client y sin client_id, sin campos vacíos — RF-8', () => {
  const body = buildPanelAppointment({ ...base, clientId: '', newClient: { name: ' Ana ', email: '', phone: '+56911112222' } }, 'owner');
  expect(body.client).toEqual({ name: 'Ana', phone: '+56911112222' });
  expect(body).not.toHaveProperty('client_id');
});

test('employee_id solo si el owner eligió uno; el staff nunca lo envía — RF-7, RF-11', () => {
  expect(buildPanelAppointment(base, 'owner')).not.toHaveProperty('employee_id');
  expect(buildPanelAppointment({ ...base, employeeId: 'u1' }, 'owner').employee_id).toBe('u1');
  expect(buildPanelAppointment({ ...base, employeeId: 'u1' }, 'staff')).not.toHaveProperty('employee_id');
});

test('las notas solo viajan si hay texto', () => {
  expect(buildPanelAppointment({ ...base, notes: '  ' }, 'owner')).not.toHaveProperty('notes');
  expect(buildPanelAppointment({ ...base, notes: ' llega tarde ' }, 'owner').notes).toBe('llega tarde');
});

test('validateAppointmentForm cubre servicio, fecha, cliente y cliente nuevo incompleto', () => {
  expect(validateAppointmentForm(base)).toBeNull();
  expect(validateAppointmentForm({ ...base, serviceId: '' })).toBe('service_required');
  expect(validateAppointmentForm({ ...base, time: '' })).toBe('datetime_required');
  expect(validateAppointmentForm({ ...base, clientId: '' })).toBe('client_required');
  expect(validateAppointmentForm({ ...base, clientId: '', newClient: { name: 'Ana', email: '', phone: '' } })).toBe('client_incomplete');
  expect(validateAppointmentForm({ ...base, clientId: '', newClient: { name: '', email: 'a@b.cl', phone: '' } })).toBe('client_incomplete');
  expect(validateAppointmentForm({ ...base, clientId: '', newClient: { name: 'Ana', email: 'a@b.cl', phone: '' } })).toBeNull();
});

test('clientMatches ignora mayúsculas y tildes y busca en nombre, email y teléfono — RF-8', () => {
  const c = { name: 'José Núñez', email: 'jose@correo.cl', phone: '+56 9 1111 2222' };
  expect(clientMatches(c, 'jose nunez')).toBe(true);
  expect(clientMatches(c, 'JOSÉ')).toBe(true);
  expect(clientMatches(c, 'correo.cl')).toBe(true);
  expect(clientMatches(c, '1111')).toBe(true);
  expect(clientMatches(c, 'maria')).toBe(false);
  expect(clientMatches({ name: 'Sin datos', email: null, phone: null }, 'sin')).toBe(true);
  expect(clientMatches(c, '  ')).toBe(true);
});

test('validateBlock exige fin posterior al inicio — RF-16', () => {
  expect(validateBlock({ date: '2026-05-14', from: '14:00', to: '18:00' })).toBeNull();
  expect(validateBlock({ date: '2026-05-14', from: '14:00', to: '14:00' })).toBe('end_not_after_start');
  expect(validateBlock({ date: '2026-05-14', from: '14:00', to: '13:00' })).toBe('end_not_after_start');
  expect(validateBlock({ date: '2026-05-14', from: '', to: '13:00' })).toBe('block_incomplete');
});

test('buildBlock: el owner elige profesional o todo el negocio (null); el staff no envía profesional — RF-14', () => {
  const form = { date: '2026-05-14', from: '14:00', to: '18:00', assignedUserId: '', notes: '' };
  expect(buildBlock(form, 'owner')).toEqual({
    assigned_user_id: null,
    scheduled_at: toLocalIso('2026-05-14', '14:00'),
    scheduled_until: toLocalIso('2026-05-14', '18:00'),
  });
  expect(buildBlock({ ...form, assignedUserId: 'u1', notes: 'Trámite' }, 'owner')).toMatchObject({ assigned_user_id: 'u1', notes: 'Trámite' });
  expect(buildBlock(form, 'staff')).not.toHaveProperty('assigned_user_id');
});
