import express from 'express';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import auth from '../middleware/auth.js';
import { inviteStaff } from '../../../application/inviteStaff.js';
import { resendStaffInvitation } from '../../../application/resendStaffInvitation.js';
import { editStaff } from '../../../application/editStaff.js';
import { deactivateStaff } from '../../../application/deactivateStaff.js';
import { listStaff } from '../../../application/listStaff.js';
import { getStaff } from '../../../application/getStaff.js';
import { getStaffAvailability } from '../../../application/getStaffAvailability.js';
import { replaceStaffAvailability } from '../../../application/replaceStaffAvailability.js';

import { parseInput } from '../../../domain/validation.js';
import { listStaffQuery } from '../../../domain/schemas/staff.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

// spec 002 RF-1..RF-9, RF-13..RF-15 — invitar (alta) a un trabajador.
router.post('/', auth, wrap(async (req, res) => {
  const { name, email, commission_rate } = req.body;
  const { user, action } = await inviteStaff(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    name,
    email,
    commissionRate: commission_rate,
  }, repos);
  res.status(action === 'create' ? 201 : 200).json({ user });
}));

// spec 002 RF-31..RF-33 — listado.
router.get('/', auth, wrap(async (req, res) => {
  const result = await listStaff(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    status: parseInput(listStaffQuery, req.query).status,
  }, repos);
  res.json(result);
}));

// spec 002 RF-34 — detalle.
router.get('/:id', auth, wrap(async (req, res) => {
  const result = await getStaff(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
  }, repos);
  res.json(result);
}));

// spec 004 RF-1, RF-2, RF-13..RF-15 — horario semanal del trabajador.
router.get('/:id/availability', auth, wrap(async (req, res) => {
  const result = await getStaffAvailability(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
  }, repos);
  res.json(result);
}));

// spec 004 RF-3..RF-12 — reemplazo total e idempotente del horario (PUT: el cuerpo es el estado final).
router.put('/:id/availability', auth, wrap(async (req, res) => {
  const result = await replaceStaffAvailability(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
    body: req.body,
  }, repos);
  res.json(result);
}));

// spec 002 RF-16..RF-19, RF-22..RF-24 — edición por el owner.
router.patch('/:id', auth, wrap(async (req, res) => {
  const updated = await editStaff(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
    body: req.body,
  }, repos);
  res.json(updated);
}));

// spec 002 RF-12, RF-13 — reenvío explícito de la invitación.
router.patch('/:id/resend-invitation', auth, wrap(async (req, res) => {
  const result = await resendStaffInvitation(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
  }, repos);
  res.json(result);
}));

// spec 002 RF-25..RF-29 — baja lógica.
router.patch('/:id/deactivate', auth, wrap(async (req, res) => {
  const result = await deactivateStaff(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
  }, repos);
  res.json(result);
}));

export default router;
