import express from 'express';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import { listAvailableSlots } from '../../../application/listAvailableSlots.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.get('/:business_id', wrap(async (req, res) => {
  const { business_id } = req.params;
  const { employee_id, service_id, date_from, date_to } = req.query;

  if (!date_from || !date_to || !service_id) throw httpErr(400, 'date_from, date_to, service_id required');

  const slots = await listAvailableSlots(db, {
    businessId: business_id,
    serviceId: service_id,
    employeeId: employee_id,
    from: new Date(date_from),
    to: new Date(date_to),
  }, repos);

  res.json(slots);
}));

export default router;
