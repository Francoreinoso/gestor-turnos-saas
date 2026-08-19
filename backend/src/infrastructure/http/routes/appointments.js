import express from 'express';
import { eq, and, ne, gte, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import { appointments, clients, services, users } from '../../../../db/schema.js';
import auth from '../middleware/auth.js';
import { createAppointment } from '../../../application/createAppointment.js';
import { assertTransition } from '../../../domain/appointment.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// Public booking — no JWT required
router.post('/', wrap(async (req, res) => {
  const { account_id, service_id, scheduled_at, client_id, client, employee_id, notes } = req.body;
  if (!account_id || !service_id || !scheduled_at) throw httpErr(400, 'missing_fields');
  if (!client_id && !client) throw httpErr(400, 'client_required');

  const result = await db.transaction(async (tx) =>
    createAppointment(tx, { accountId: account_id, serviceId: service_id, scheduledAt: scheduled_at, clientId: client_id, clientData: client, employeeId: employee_id, notes }, repos)
  );

  res.status(201).json(result);
}));

router.get('/', auth, wrap(async (req, res) => {
  const { type, date_from, date_to, status } = req.query;
  let { employee_id } = req.query;

  if (req.user.role === 'staff') employee_id = req.user.id;

  const conditions = [eq(appointments.account_id, req.user.account_id)];
  if (employee_id) conditions.push(eq(appointments.assigned_user_id, employee_id));
  if (type) conditions.push(eq(appointments.status, type));
  if (status) conditions.push(eq(appointments.status, status));
  if (date_from) conditions.push(gte(appointments.scheduled_at, new Date(date_from)));
  if (date_to) conditions.push(lte(appointments.scheduled_at, new Date(date_to)));

  const result = await db.query.appointments.findMany({
    where: and(...conditions),
    with: {
      client: { columns: { id: true, name: true, email: true, phone: true } },
      service: { columns: { id: true, name: true, duration_minutes: true, price: true } },
      assignedUser: { columns: { id: true, name: true } },
    },
    orderBy: (a, { asc }) => [asc(a.scheduled_at)],
  });

  res.json(result);
}));

router.get('/:id', auth, wrap(async (req, res) => {
  const appointment = await db.query.appointments.findFirst({
    where: and(eq(appointments.id, req.params.id), eq(appointments.account_id, req.user.account_id)),
    with: {
      client: { columns: { id: true, name: true, email: true, phone: true } },
      service: { columns: { id: true, name: true, duration_minutes: true, price: true } },
      assignedUser: { columns: { id: true, name: true } },
    },
  });

  // 404 for cross-tenant and for staff accessing another employee's appointment (no info leak)
  if (!appointment) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && appointment.assigned_user_id !== req.user.id) throw httpErr(404, 'not_found');

  res.json(appointment);
}));

router.post('/block', auth, wrap(async (req, res) => {
  let { assigned_user_id, scheduled_at, scheduled_until, notes } = req.body;
  if (!scheduled_at || !scheduled_until) throw httpErr(400, 'missing_fields');

  // Staff can only block their own slots; owner with null creates a whole-business block
  if (req.user.role === 'staff') assigned_user_id = req.user.id;

  let appointment;
  try {
    appointment = await repos.appointments.create(db, {
      account_id: req.user.account_id,
      assigned_user_id: assigned_user_id ?? null,
      scheduled_at,
      scheduled_until,
      status: 'bloqueado',
      notes,
    });
  } catch (err) {
    if ((err.cause?.message ?? err.message) === 'appointment_overlap') throw httpErr(409, 'appointment_overlap');
    throw err;
  }

  res.status(201).json(appointment);
}));

router.patch('/:id/cancel', auth, wrap(async (req, res) => {
  const appointment = await repos.appointments.findOne(db, [
    eq(appointments.id, req.params.id),
    eq(appointments.account_id, req.user.account_id),
  ]);

  if (!appointment) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && appointment.assigned_user_id !== req.user.id) throw httpErr(404, 'not_found');

  assertTransition(appointment.status, 'cancelado');
  const updated = await repos.appointments.update(db, appointment.id, { status: 'cancelado' });
  res.json(updated);
}));

router.patch('/:id/cancel-block', auth, wrap(async (req, res) => {
  const appointment = await repos.appointments.findOne(db, [
    eq(appointments.id, req.params.id),
    eq(appointments.account_id, req.user.account_id),
    eq(appointments.status, 'bloqueado'),
  ]);

  if (!appointment) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && appointment.assigned_user_id !== req.user.id) throw httpErr(403, 'forbidden');

  await repos.appointments.delete(db, appointment.id);
  res.status(204).end();
}));

router.patch('/:id/correct', auth, wrap(async (req, res) => {
  const appointment = await repos.appointments.findOne(db, [
    eq(appointments.id, req.params.id),
    eq(appointments.account_id, req.user.account_id),
  ]);

  if (!appointment) throw httpErr(404, 'not_found');

  const next = appointment.status === 'completado' ? 'no_llego' : 'completado';
  assertTransition(appointment.status, next);
  const updated = await repos.appointments.update(db, appointment.id, { status: next });
  res.json(updated);
}));

export default router;
