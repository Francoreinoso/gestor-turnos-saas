import express from 'express';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import auth from '../middleware/auth.js';
import { getPaymentsSummary } from '../../../application/getPaymentsSummary.js';
import { listPayments } from '../../../application/listPayments.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

// spec 003 RF-1..RF-7, RF-11..RF-18, RF-21 — resumen agregado + desglose por
// profesional, siempre en la misma respuesta (D1). Query: period, date_from,
// date_to, employee_id.
router.get('/summary', auth, wrap(async (req, res) => {
  const result = await getPaymentsSummary(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    query: req.query,
    now: new Date(),
  }, repos);
  res.json(result);
}));

// spec 003 RF-8..RF-10, RF-11..RF-18, RF-21 — listado detallado de pagos.
router.get('/', auth, wrap(async (req, res) => {
  const result = await listPayments(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    query: req.query,
    now: new Date(),
  }, repos);
  res.json(result);
}));

export default router;
