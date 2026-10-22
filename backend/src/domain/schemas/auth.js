// spec 007 — registro y login.
import { z } from 'zod';
import { requiredText, requiredRaw, requiredEmail } from './common.js';

export const registerBody = z.object({
  business_name: requiredText(),
  name: requiredText(),
  email: requiredEmail(),
  password: requiredRaw(),
});

export const loginBody = z.object({
  email: requiredEmail(),
  password: requiredRaw(),
});
