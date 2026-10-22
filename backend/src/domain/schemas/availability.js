// spec 007 — GET /availability/:business_id. spec 008 D11: el código de ausencia pasa de prosa con espacios a `missing_fields`.
import { z } from 'zod';
import { rule } from '../validation.js';
import { isValidDate, uuidField, optionalUuid } from './common.js';

const REQUIRED = 'missing_fields';
const required = (wrong) => z.string({ error: (iss) => rule(iss.input == null ? REQUIRED : wrong) }).min(1, rule(REQUIRED));

export const slotsQuery = z.object({
  date_from: required('invalid_date'),
  date_to: required('invalid_date'),
  service_id: uuidField({ missing: REQUIRED, wrong: 'invalid_body' }), // spec 008 RF-6
  employee_id: optionalUuid(),
}).refine((q) => isValidDate(q.date_from) && isValidDate(q.date_to), rule('invalid_date')); // D-P6
