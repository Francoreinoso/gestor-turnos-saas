// spec 007 — trabajadores, perfil propio y horario semanal (reemplaza a domain/staffEdit.js en lo que es forma).
import { z } from 'zod';
import { rule } from '../validation.js';
import { requiredText, requiredEmail, commissionRate, editSchema, passwordInRange } from './common.js';

const invalidField = rule('invalid_field');

// POST /staff — comisión inválida → 422 (spec 002 RF-4).
export const inviteStaffBody = z.object({
  name: requiredText(),
  email: requiredEmail(),
  commission_rate: commissionRate(422).optional(),
});

// PATCH /staff/:id (spec 002 RF-16, RF-19, RF-23): null solo limpia la comisión.
export const editStaffBody = editSchema({
  name: z.string({ error: invalidField }).trim(),
  email: z.string({ error: invalidField }).toLowerCase(),
  commission_rate: commissionRate(422),
}, { nullable: ['commission_rate'] });

// PATCH /me (spec 002 RF-20, RF-21): nunca email/rol/comisión. La contraseña no se recorta.
export const editSelfBody = editSchema({
  name: z.string({ error: invalidField }).trim(),
  password: z.string({ error: invalidField }).refine(passwordInRange, rule('invalid_password')), // spec 008 RF-11
});

export const listStaffQuery = z.object({
  status: z.string({ error: rule('invalid_body') }).optional(),
});

// ── Horario semanal (spec 004). Forma → 400, valores → 422; los valores se evalúan recién cuando toda la forma es válida (RF-5). ──
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const present = (v) => v !== undefined && v !== null;
const invalidWindow = rule('invalid_window');

const windowShape = z.any()
  .refine((w) => w !== null && typeof w === 'object' && !Array.isArray(w), invalidWindow)
  .refine((w) => ['day_of_week', 'start_time', 'end_time'].every((k) => present(w?.[k])), rule('missing_fields'));

const timeValue = z.string({ error: rule('invalid_time_format', 422) }).regex(TIME_REGEX, rule('invalid_time_format', 422));

const windowValues = z.object({
  day_of_week: z.number({ error: rule('invalid_day_of_week', 422) }).int(rule('invalid_day_of_week', 422))
    .min(0, rule('invalid_day_of_week', 422)).max(6, rule('invalid_day_of_week', 422)),
  start_time: timeValue,
  end_time: timeValue,
}).refine((w) => toMinutes(w.start_time) < toMinutes(w.end_time), rule('start_must_be_before_end', 422));

export const availabilityWindowsBody = z.array(windowShape, { error: rule('invalid_body') })
  .pipe(z.array(windowValues));
