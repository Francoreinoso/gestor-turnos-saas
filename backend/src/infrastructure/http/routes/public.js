import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import publicAuth from '../middleware/publicAuth.js';
import { createAppointment } from '../../../application/createAppointment.js';
import { rescheduleAppointment } from '../../../application/rescheduleAppointment.js';
import { activateStaffAccount } from '../../../application/activateStaffAccount.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// ponytail: 20 req/15min per IP — tighten if brute-force becomes a concern
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { error: 'too_many_requests' } }));

// Booking público — sin JWT (el cliente aún no tiene token). Bajo el rate-limit del grupo.
// spec 001 D-P2: se movió acá desde POST /appointments para liberar esa ruta al panel.
router.post('/bookings', wrap(async (req, res) => {
  const { account_id, service_id, scheduled_at, client_id, client, employee_id, notes } = req.body;
  if (!account_id || !service_id || !scheduled_at) throw httpErr(400, 'missing_fields');
  if (!client_id && !client) throw httpErr(400, 'client_required');

  const result = await db.transaction(async (tx) =>
    createAppointment(tx, {
      accountId: account_id, serviceId: service_id, scheduledAt: scheduled_at,
      clientId: client_id, clientData: client, employeeId: employee_id, notes,
    }, repos),
  );

  res.status(201).json(result);
}));

router.patch('/appointments/:id/cancel', publicAuth, wrap(async (req, res) => {
  const appointment = await repos.appointments.findById(db, req.params.id);
  if (!appointment || appointment.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  await repos.appointments.update(db, appointment.id, { status: 'cancelado' });
  res.json({ message: 'appointment_cancelled' });
}));

router.patch('/appointments/:id/reschedule', publicAuth, wrap(async (req, res) => {
  const { service_id, scheduled_at, employee_id, notes } = req.body;
  if (!scheduled_at) throw httpErr(400, 'missing_fields');

  const old = await repos.appointments.findById(db, req.params.id);
  if (!old) throw httpErr(404, 'not_found');

  const result = await rescheduleAppointment(db, old, { serviceId: service_id, scheduledAt: scheduled_at, employeeId: employee_id, notes }, repos);
  res.status(201).json(result);
}));

// spec 002 RF-10, RF-11 — activar la cuenta de un trabajador invitado.
// Sin publicAuth: el token se valida dentro del use case (D-P7), mismo patrón que /bookings.
router.post('/staff-invitations/activate', wrap(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw httpErr(400, 'missing_fields');

  const result = await activateStaffAccount(db, { token, password }, repos);
  res.json(result);
}));

export default router;
