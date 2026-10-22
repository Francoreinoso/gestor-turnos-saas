// spec 007 — GET /availability/:business_id. El código de ausencia con espacios es parte del contrato público.
import { z } from 'zod';
import { rule } from '../validation.js';
import { isValidDate } from './common.js';

const REQUIRED = 'date_from, date_to, service_id required';
const required = (wrong) => z.string({ error: (iss) => rule(iss.input == null ? REQUIRED : wrong) }).min(1, rule(REQUIRED));

export const slotsQuery = z.object({
  date_from: required('invalid_date'),
  date_to: required('invalid_date'),
  service_id: required('invalid_body'),
  employee_id: z.string({ error: rule('invalid_body') }).optional(),
}).refine((q) => isValidDate(q.date_from) && isValidDate(q.date_to), rule('invalid_date')); // D-P6
