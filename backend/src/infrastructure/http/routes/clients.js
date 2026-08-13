import express from 'express';
import { db } from '../../db/client.js';
import { clientRepo } from '../../db/repositories/clients.js';
import auth from '../middleware/auth.js';
import { normalizeEmail, validatePhone } from '../../../domain/client.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.post('/', auth, wrap(async (req, res) => {
  const { name, email, phone, notes } = req.body;
  if (!name) throw httpErr(400, 'missing_fields');
  if (!email && !phone) throw httpErr(400, 'email_or_phone_required');
  if (phone) validatePhone(phone);

  const client = await clientRepo.create(db, {
    account_id: req.user.account_id,
    name,
    email: email ? normalizeEmail(email) : null,
    phone: phone || null,
    notes,
  });

  res.status(201).json(client);
}));

router.get('/', auth, wrap(async (req, res) => {
  res.json(await clientRepo.findAll(db, req.user.account_id));
}));

router.get('/:id', auth, wrap(async (req, res) => {
  const client = await clientRepo.findById(db, req.params.id);
  if (!client || client.account_id !== req.user.account_id) throw httpErr(404, 'not_found');
  res.json(client);
}));

router.patch('/:id', auth, wrap(async (req, res) => {
  const client = await clientRepo.findById(db, req.params.id);
  if (!client || client.account_id !== req.user.account_id) throw httpErr(404, 'not_found');

  const { name, email, phone, notes } = req.body;
  if (phone) validatePhone(phone);

  res.json(await clientRepo.update(db, client.id, {
    name: name ?? client.name,
    email: email ? normalizeEmail(email) : client.email,
    phone: phone ?? client.phone,
    notes: notes ?? client.notes,
  }));
}));

export default router;
