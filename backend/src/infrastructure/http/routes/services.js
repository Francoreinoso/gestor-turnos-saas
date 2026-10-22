import express from 'express';
import { db } from '../../db/client.js';
import { serviceRepo } from '../../db/repositories/services.js';
import auth from '../middleware/auth.js';
import { parseInput } from '../../../domain/validation.js';
import { createServiceBody, editServiceBody, priceBody } from '../../../domain/schemas/services.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const ownerOnly = (req, res, next) => req.user.role === 'owner' ? next() : res.status(403).json({ error: 'forbidden' });

router.post('/', auth, ownerOnly, wrap(async (req, res) => {
  const { name, duration_minutes, price } = parseInput(createServiceBody, req.body);

  const service = await db.transaction(async (tx) => {
    const s = await serviceRepo.create(tx, { account_id: req.user.account_id, name, duration_minutes, price });
    await serviceRepo.addPriceHistory(tx, s.id, price);
    return s;
  });

  res.status(201).json(service);
}));

router.get('/', auth, wrap(async (req, res) => {
  const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
  res.json(await serviceRepo.findAll(db, req.user.account_id, { active }));
}));

router.get('/:id', auth, wrap(async (req, res) => {
  const service = await serviceRepo.findById(db, req.params.id, req.user.account_id);
  if (!service) throw httpErr(404, 'not_found');
  res.json(service);
}));

router.patch('/:id', auth, ownerOnly, wrap(async (req, res) => {
  const service = await serviceRepo.findById(db, req.params.id, req.user.account_id);
  if (!service) throw httpErr(404, 'not_found');

  const { name, duration_minutes } = parseInput(editServiceBody, req.body);
  res.json(await serviceRepo.update(db, service.id, { name, duration_minutes }));
}));

router.patch('/:id/prices', auth, ownerOnly, wrap(async (req, res) => {
  const { price } = parseInput(priceBody, req.body);

  const service = await serviceRepo.findById(db, req.params.id, req.user.account_id);
  if (!service) throw httpErr(404, 'not_found');

  const updated = await db.transaction(async (tx) => {
    const s = await serviceRepo.update(tx, service.id, { price });
    await serviceRepo.addPriceHistory(tx, service.id, price);
    return s;
  });

  res.json(updated);
}));

router.patch('/:id/deactivate', auth, ownerOnly, wrap(async (req, res) => {
  const service = await serviceRepo.findById(db, req.params.id, req.user.account_id);
  if (!service) throw httpErr(404, 'not_found');
  res.json(await serviceRepo.update(db, service.id, { active: false }));
}));

export default router;
