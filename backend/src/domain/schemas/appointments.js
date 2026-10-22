// spec 007 — turnos: alta desde el panel, bloqueo, edición estricta y listado.
import { z } from 'zod';
import { rule } from '../validation.js';
import { isoDate, isValidDate, uuidField, optionalUuid, optionalText, clientData, editSchema } from './common.js';

const invalidDate = rule('invalid_date');
const optionalString = () => z.string({ error: rule('invalid_body') }).optional();

// POST /appointments — el panel puede cargar turnos pasados. La fecha se evalúa tras el chequeo de presencia (RF-4/RF-15).
export const panelAppointmentBody = z.object({
  service_id: uuidField(),
  scheduled_at: isoDate({ check: false }),
  client_id: optionalUuid(),
  client: clientData().optional(),
  employee_id: optionalUuid(),
  notes: optionalText(),
}).refine((b) => b.client_id || b.client, rule('missing_fields'))
  .refine((b) => isValidDate(b.scheduled_at), invalidDate);

// POST /appointments/block
export const blockBody = z.object({
  assigned_user_id: z.string({ error: rule('invalid_body') }).nullish(),
  scheduled_at: isoDate({ check: false }),
  scheduled_until: isoDate({ check: false }),
  notes: optionalText(),
}).refine((b) => isValidDate(b.scheduled_at) && isValidDate(b.scheduled_until), invalidDate);

// PATCH /appointments/:id (spec 001 RF-19..RF-22): solo notes (admite null para limpiarse), servicio, cliente y profesional.
const invalidField = rule('invalid_field');
export const editAppointmentBody = editSchema({
  notes: z.string({ error: invalidField }).trim().nullable(),
  service_id: z.string({ error: invalidField }).refine((v) => uuidField().safeParse(v).success, invalidField),
  client_id: z.string({ error: invalidField }).refine((v) => uuidField().safeParse(v).success, invalidField),
  assigned_user_id: z.string({ error: invalidField }).refine((v) => uuidField().safeParse(v).success, invalidField),
}, { nullable: ['notes'] });

// GET /appointments — solo tipos; la fecha ilegible (RF-39) se resuelve en listAppointments al convertir a Date.
export const listAppointmentsQuery = z.object({
  status: optionalString(),
  type: optionalString(),
  date_from: z.string({ error: invalidDate }).optional(),
  date_to: z.string({ error: invalidDate }).optional(),
  employee_id: optionalString(),
});
