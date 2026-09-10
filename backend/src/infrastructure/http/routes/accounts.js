import express from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import { users } from '../../../../db/schema.js';
import auth from '../middleware/auth.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

function validateRate(rate) {
  if (rate === null) return true;
  return typeof rate === 'number' && rate >= 0 && rate <= 1;
}

// PATCH /accounts/commission — set default commission for this account (owner only)
router.patch('/commission', auth, wrap(async (req, res) => {
  if (req.user.role !== 'owner') throw httpErr(403, 'forbidden');

  const { commission_rate } = req.body;
  if (!validateRate(commission_rate)) throw httpErr(400, 'invalid_commission_rate');

  const updated = await repos.accounts.updateCommission(db, req.user.account_id, commission_rate);
  res.json(updated);
}));

// PATCH /accounts/users/:id/commission — set override commission for one employee (owner only)
router.patch('/users/:id/commission', auth, wrap(async (req, res) => {
  if (req.user.role !== 'owner') throw httpErr(403, 'forbidden');

  const { commission_rate } = req.body;
  if (!validateRate(commission_rate)) throw httpErr(400, 'invalid_commission_rate');

  // Verify user belongs to this account (404 on miss — no info leak)
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, req.params.id), eq(users.account_id, req.user.account_id)),
  });
  if (!user) throw httpErr(404, 'not_found');

  const updated = await db.update(users)
    .set({ commission_rate })
    .where(eq(users.id, req.params.id))
    .returning()
    .then(r => r[0]);

  res.json(updated);
}));

export default router;
