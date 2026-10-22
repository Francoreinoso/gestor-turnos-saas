// spec 007 — registro y login.
import { z } from 'zod';
import { requiredText, requiredRaw, requiredEmail, newPassword } from './common.js';

export const registerBody = z.object({
  business_name: requiredText(),
  name: requiredText(),
  email: requiredEmail(),
  password: newPassword(), // spec 008 RF-11
});

export const loginBody = z.object({
  email: requiredEmail(),
  password: requiredRaw(),
});
