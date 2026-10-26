import express from 'express';
import { db } from '../../db/client.js';
import { clientRepo } from '../../db/repositories/clients.js';
import auth from '../middleware/auth.js';
import { parseInput } from '../../../domain/validation.js';
import { createClientBody, editClientBody } from '../../../domain/schemas/clients.js';
import { uuidParams } from '../middleware/uuidParams.js';

const router = express.Router();
uuidParams(router);
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 011 RF-19: email y teléfono son únicos dentro de la cuenta (migración 0008). El índice es el que decide,
// también ante dos altas simultáneas; aquí solo se traduce el choque a 409 en vez de 500.
const TAKEN = { clients_account_email_unique: 'email_taken', clients_account_phone_unique: 'phone_taken' };
const mapTaken = (err) => {
  const pg = err.cause ?? err;
  if (pg.code === '23505' && TAKEN[pg.constraint]) throw httpErr(409, TAKEN[pg.constraint]);
  throw err;
};

router.post('/', auth, wrap(async (req, res) => {
  const { name, email, phone, notes } = parseInput(createClientBody, req.body);

  const client = await clientRepo.create(db, {
    account_id: req.user.account_id,
    name,
    email: email || null,
    phone: phone || null,
    notes,
  }).catch(mapTaken);

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

  const { name, email, phone, notes } = parseInput(editClientBody, req.body);

  res.json(await clientRepo.update(db, client.id, {
    name: name ?? client.name,
    email: email || client.email,
    phone: phone ?? client.phone,
    notes: notes ?? client.notes,
  }).catch(mapTaken));
}));

export default router;
