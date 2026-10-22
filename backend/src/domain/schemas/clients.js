// spec 007 — clientes. Orden de evaluación: missing_fields → email_or_phone_required → invalid_phone_format.
import { z } from 'zod';
import { rule } from '../validation.js';
import { requiredText, optionalText, phone } from './common.js';

const emailField = () => z.string({ error: rule('invalid_body') }).toLowerCase().nullish();

export const createClientBody = z.object({
  name: requiredText(),
  email: emailField(),
  phone: z.unknown().optional(),
  notes: optionalText(),
}).refine((c) => c.email || c.phone, rule('email_or_phone_required'))
  .pipe(z.object({
    name: z.string(),
    email: z.string().nullish(),
    phone: phone(),
    notes: z.string().nullish(),
  }));

export const editClientBody = z.object({
  name: z.string({ error: rule('invalid_body') }).trim().nullish(),
  email: emailField(),
  phone: phone(),
  notes: optionalText(),
});
