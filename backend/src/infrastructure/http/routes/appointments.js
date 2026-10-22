import express from 'express';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import auth from '../middleware/auth.js';
import { correctAppointment } from '../../../application/correctAppointment.js';
import { createAppointmentFromPanel } from '../../../application/createAppointmentFromPanel.js';
import { editAppointment } from '../../../application/editAppointment.js';
import { cancelAppointment } from '../../../application/cancelAppointment.js';
import { cancelBlock } from '../../../application/cancelBlock.js';
import { listAppointments } from '../../../application/listAppointments.js';
import { getAppointment } from '../../../application/getAppointment.js';
import { parseInput } from '../../../domain/validation.js';
import { panelAppointmentBody, blockBody } from '../../../domain/schemas/appointments.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

// spec 001 RF-1..RF-18 — creación desde el panel autenticado.
// (El booking público vive en POST /public/bookings.)
router.post('/', auth, wrap(async (req, res) => {
  const { service_id, scheduled_at, client_id, client, employee_id, notes } = parseInput(panelAppointmentBody, req.body);
  const result = await createAppointmentFromPanel(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    serviceId: service_id,
    scheduledAt: scheduled_at,
    clientId: client_id,
    clientData: client,
    employeeId: employee_id,
    notes,
  }, repos);
  res.status(201).json(result);
}));

// spec 001 RF-36..RF-42 — listado con filtros.
router.get('/', auth, wrap(async (req, res) => {
  const result = await listAppointments(db, {
    accountId: req.user.account_id,
    actor: actorOf(req),
    query: req.query,
  }, repos);
  res.json(result);
}));

// spec 001 RF-34 / RF-43 — detalle.
router.get('/:id', auth, wrap(async (req, res) => {
  const result = await getAppointment(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
  }, repos);
  res.json(result);
}));

// spec 001 RF-19..RF-29, RF-33 — edición in-place. Campos whitelisteados, sin `status` (principio 7).
router.patch('/:id', auth, wrap(async (req, res) => {
  const updated = await editAppointment(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
    body: req.body,
  }, repos);
  res.json(updated);
}));

router.post('/block', auth, wrap(async (req, res) => {
  let { assigned_user_id, scheduled_at, scheduled_until, notes } = parseInput(blockBody, req.body);
  const startsAt = new Date(scheduled_at);
  const endsAt = new Date(scheduled_until);

  // Staff can only block their own slots; owner with null creates a whole-business block
  if (req.user.role === 'staff') assigned_user_id = req.user.id;

  let appointment;
  try {
    appointment = await repos.appointments.create(db, {
      account_id: req.user.account_id,
      assigned_user_id: assigned_user_id ?? null,
      scheduled_at: startsAt,
      scheduled_until: endsAt,
      status: 'bloqueado',
      notes,
    });
  } catch (err) {
    if ((err.cause?.message ?? err.message) === 'appointment_overlap') throw httpErr(409, 'appointment_overlap');
    throw err;
  }

  res.status(201).json(appointment);
}));

// spec 001 RF-44 / RF-45 — cancelar un turno agendado.
router.patch('/:id/cancel', auth, wrap(async (req, res) => {
  const found = await repos.appointments.findVisible(db, { id: req.params.id, accountId: req.user.account_id });
  if (!found) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && found.assigned_user_id !== req.user.id) throw httpErr(404, 'not_found');

  const updated = await cancelAppointment(db, found.id, repos);
  res.json(updated);
}));

// spec 001 RF-32, RF-46..RF-48 — baja lógica de un bloqueo (antes DELETE físico + 204).
router.patch('/:id/cancel-block', auth, wrap(async (req, res) => {
  const updated = await cancelBlock(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    actor: actorOf(req),
  }, repos);
  res.json(updated);
}));

// spec 001 (comportamiento existente) + spec 003 RF-19/RF-20 — ventana de
// corrección de un día calendario UTC, en ambos sentidos.
router.patch('/:id/correct', auth, wrap(async (req, res) => {
  const updated = await correctAppointment(db, {
    id: req.params.id,
    accountId: req.user.account_id,
    now: new Date(),
  }, repos);
  res.json(updated);
}));

export default router;
