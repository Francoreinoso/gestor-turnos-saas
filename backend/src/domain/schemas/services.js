// spec 007 — servicios.
import { z } from 'zod';
import { rule } from '../validation.js';
import { requiredText, typeError } from './common.js';

const bad = rule('invalid_body');

// duration_minutes: entero > 0. El 0 sigue respondiendo missing_fields (antes: `!duration_minutes`).
const duration = () => z.number({ error: typeError('missing_fields') })
  .int(bad)
  .positive({ error: (iss) => rule(iss.input === 0 ? 'missing_fields' : 'invalid_body') });

// price: decimal ≥ 0, número o string ("1500.00"). Ausente → missing_fields.
const DECIMAL_RE = /^\d+(\.\d+)?$/;
export const price = () => z.union([
  z.number().min(0),
  z.string().regex(DECIMAL_RE),
], { error: typeError('missing_fields') });

export const createServiceBody = z.object({
  name: requiredText(),
  duration_minutes: duration(),
  price: price(),
});

export const editServiceBody = z.object({
  name: z.string({ error: bad }).trim().optional(),
  duration_minutes: z.number({ error: bad }).int(bad).positive(bad).optional(),
});

export const priceBody = z.object({ price: price() });
