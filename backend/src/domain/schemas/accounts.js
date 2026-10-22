// spec 007 — comisiones (PATCH /accounts/commission y /accounts/users/:id/commission). Forma y rango → 400.
import { z } from 'zod';
import { commissionRate } from './common.js';

export const commissionBody = z.object({ commission_rate: commissionRate(400) });
