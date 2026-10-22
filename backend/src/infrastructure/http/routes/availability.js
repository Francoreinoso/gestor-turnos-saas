import express from 'express';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import { listAvailableSlots } from '../../../application/listAvailableSlots.js';
import { parseInput } from '../../../domain/validation.js';
import { slotsQuery } from '../../../domain/schemas/availability.js';
import { uuidParams } from '../middleware/uuidParams.js';

const router = express.Router();
uuidParams(router, { business_id: 'service_not_found' });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

router.get('/:business_id', wrap(async (req, res) => {
  const { business_id } = req.params;
  const { employee_id, service_id, date_from, date_to } = parseInput(slotsQuery, req.query);

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
