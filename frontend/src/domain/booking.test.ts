import { test, expect } from 'vitest';
import { validateClient, buildBookingPayload, manageLink } from './booking';

test('validateClient: sin nombre → error en name', () => {
  expect(validateClient({ name: '  ', email: 'a@b.com', phone: '' }).name).toBeTruthy();
});

test('validateClient: sin email ni teléfono → error de contacto', () => {
  const errors = validateClient({ name: 'Ana', email: '', phone: '' });
  expect(errors.contact).toBeTruthy();
});

test('validateClient: teléfono internacional válido pasa', () => {
  expect(validateClient({ name: 'Ana', email: '', phone: '+5491155551234' })).toEqual({});
});

test('validateClient: teléfono sin + o con letras se rechaza', () => {
  expect(validateClient({ name: 'Ana', email: '', phone: '1155551234' }).phone).toBeTruthy();
  expect(validateClient({ name: 'Ana', email: '', phone: '+54abc' }).phone).toBeTruthy();
  expect(validateClient({ name: 'Ana', email: '', phone: '+123456' }).phone).toBeTruthy();
});

test('validateClient: email sin @ se rechaza; con @ pasa', () => {
  expect(validateClient({ name: 'Ana', email: 'ana.example.com', phone: '' }).email).toBeTruthy();
  expect(validateClient({ name: 'Ana', email: 'ana@example.com', phone: '' })).toEqual({});
});

test('validateClient: email válido + teléfono inválido sigue marcando el teléfono', () => {
  const errors = validateClient({ name: 'Ana', email: 'a@b.com', phone: '123' });
  expect(errors.phone).toBeTruthy();
  expect(errors.contact).toBeUndefined();
});

const base = {
  accountId: 'acc-1', serviceId: 'svc-1', scheduledAt: '2030-01-07T12:00:00.000Z',
  client: { name: ' Ana ', email: ' ana@x.com ', phone: '' }, notes: '',
};

test('buildBookingPayload: "Cualquiera" no envía employee_id', () => {
  const payload = buildBookingPayload({ ...base, employeeId: null });
  expect('employee_id' in payload).toBe(false);
});

test('buildBookingPayload: un profesional concreto envía su employee_id', () => {
  expect(buildBookingPayload({ ...base, employeeId: 'usr-1' }).employee_id).toBe('usr-1');
});

test('buildBookingPayload: recorta espacios, omite contacto y notas vacíos', () => {
  const payload = buildBookingPayload({ ...base, employeeId: null });
  expect(payload).toEqual({
    account_id: 'acc-1', service_id: 'svc-1', scheduled_at: '2030-01-07T12:00:00.000Z',
    client: { name: 'Ana', email: 'ana@x.com' },
  });
});

test('buildBookingPayload: incluye teléfono y notas cuando existen', () => {
  const payload = buildBookingPayload({ ...base, client: { name: 'Ana', email: '', phone: '+5491155551234' }, notes: ' tengo apuro ', employeeId: null });
  expect(payload.client).toEqual({ name: 'Ana', phone: '+5491155551234' });
  expect(payload.notes).toBe('tengo apuro');
});

test('manageLink: arma /turno/:id?token=… con el origen dado y escapa el token', () => {
  expect(manageLink('https://turnos.test', 'abc-123', 'tok')).toBe('https://turnos.test/turno/abc-123?token=tok');
  expect(manageLink('https://turnos.test', 'abc', 'a b&c=d')).toBe('https://turnos.test/turno/abc?token=a%20b%26c%3Dd');
});
