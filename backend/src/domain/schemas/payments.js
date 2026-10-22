// spec 007 — query de pagos: solo tipos. `ambiguous_period_filter` e `invalid_period` siguen en domain/paymentsPeriod.js
// (el orden ambigüedad → fecha → preset cambiaría con una validación por campos).
import { z } from 'zod';
import { rule } from '../validation.js';

const period = () => z.string({ error: rule('invalid_period') }).optional();

export const paymentsQuery = z.object({
  period: period(),
  date_from: period(),
  date_to: period(),
  employee_id: z.string({ error: rule('invalid_body') }).optional(),
});
