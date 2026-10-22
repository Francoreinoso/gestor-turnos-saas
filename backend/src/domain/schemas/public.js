// spec 007 — rutas públicas (sin login).
import { z } from 'zod';
import { rule } from '../validation.js';
import { uuidField, optionalUuid, optionalText, clientData, isoDate, requiredRaw, newPassword } from './common.js';

// scheduled_at solo se exige como string: `invalid_scheduled_at` y la fecha pasada los resuelve assertScheduledAtNotPast (D-P3).
const scheduledAt = () => isoDate({ invalid: 'invalid_scheduled_at', check: false });

export const publicBookingBody = z.object({
  account_id: uuidField(),
  service_id: uuidField(),
  scheduled_at: scheduledAt(),
  client_id: optionalUuid(),
  client: clientData().optional(),
  employee_id: optionalUuid(),
  notes: optionalText(),
}).refine((b) => b.client_id || b.client, rule('client_required'));

export const rescheduleBody = z.object({
  service_id: optionalUuid(),
  scheduled_at: scheduledAt(),
  employee_id: optionalUuid(),
  notes: optionalText(),
});

export const activateBody = z.object({
  token: requiredRaw(),
  password: newPassword(), // spec 008 RF-11
});
