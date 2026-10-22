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
import { getAppUrl } from '../appUrl.js';
import { uuidParams } from '../middleware/uuidParams.js';

const router = express.Router();
uuidParams(router);
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

// spec 002 RF-1..RF-9, RF-13..RF-15 — invitar (alta) a un trabajador.
router.post('/', auth, wrap(async (req, res) => {
  const { user, action, invitation_link } = await inviteStaff(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    body: req.body, // spec 008 RF-4: se valida en el caso de uso, después del chequeo de rol
    appUrl: getAppUrl(),
  }, repos);
  // spec 009 RF-21: `invitation_link` solo viaja en esta respuesta y en la del reenvío, y solo al owner (el caso de uso rechaza a staff).
  res.status(action === 'create' ? 201 : 200).json({ user, action, invitation_link }); // `action` (create | reactivate | resend) deja a la pantalla distinguir una reactivación (spec 009 R5)
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
    appUrl: getAppUrl(),
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
