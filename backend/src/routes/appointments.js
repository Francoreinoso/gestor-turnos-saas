'use strict';

const router = require('express').Router();
const { Op } = require('sequelize');
const { Appointment, Client, Service, User } = require('../models');
const auth = require('../middleware/auth');
const { createAppointment } = require('../utils/appointment');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// Public booking — no JWT required
router.post('/', wrap(async (req, res) => {
  const { account_id, service_id, scheduled_at, client_id, client, employee_id, notes } = req.body;
  if (!account_id || !service_id || !scheduled_at) throw httpErr(400, 'missing_fields');
  if (!client_id && !client) throw httpErr(400, 'client_required');

  const result = await Appointment.sequelize.transaction(async (t) => {
    return createAppointment({
      accountId: account_id,
      serviceId: service_id,
      scheduledAt: scheduled_at,
      clientId: client_id,
      clientData: client,
      employeeId: employee_id,
      notes,
      t,
    });
  });

  res.status(201).json(result);
}));

router.get('/', auth, wrap(async (req, res) => {
  const { type, date_from, date_to, status } = req.query;
  let { employee_id } = req.query;

  // Staff can only see their own appointments — silently ignore other employee_id values
  if (req.user.role === 'staff') employee_id = req.user.id;

  const where = { account_id: req.user.account_id };
  if (employee_id) where.assigned_user_id = employee_id;
  if (type) where.status = type; // legacy alias
  if (status) where.status = status;
  if (date_from || date_to) {
    where.scheduled_at = {};
    if (date_from) where.scheduled_at[Op.gte] = new Date(date_from);
    if (date_to) where.scheduled_at[Op.lte] = new Date(date_to);
  }

  const appointments = await Appointment.findAll({
    where,
    include: [
      { model: Client, attributes: ['id', 'name', 'email', 'phone'] },
      { model: Service, attributes: ['id', 'name', 'duration_minutes', 'price'] },
      { model: User, as: 'assignedUser', attributes: ['id', 'name'] },
    ],
    order: [['scheduled_at', 'ASC']],
  });

  res.json(appointments);
}));

router.get('/:id', auth, wrap(async (req, res) => {
  const appointment = await Appointment.findOne({
    where: { id: req.params.id, account_id: req.user.account_id },
    include: [
      { model: Client, attributes: ['id', 'name', 'email', 'phone'] },
      { model: Service, attributes: ['id', 'name', 'duration_minutes', 'price'] },
      { model: User, as: 'assignedUser', attributes: ['id', 'name'] },
    ],
  });

  // 404 for cross-tenant and for staff accessing another employee's appointment (no info leak)
  if (!appointment) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && appointment.assigned_user_id !== req.user.id) throw httpErr(404, 'not_found');

  res.json(appointment);
}));

router.post('/block', auth, wrap(async (req, res) => {
  let { assigned_user_id, scheduled_at, scheduled_until, notes } = req.body;
  if (!scheduled_at || !scheduled_until) throw httpErr(400, 'missing_fields');

  // Staff can only block their own slots
  if (req.user.role === 'staff') assigned_user_id = req.user.id;
  // Owner with assigned_user_id=null creates a whole-business block

  let appointment;
  try {
    appointment = await Appointment.create({
      account_id: req.user.account_id,
      assigned_user_id: assigned_user_id ?? null,
      scheduled_at,
      scheduled_until,
      status: 'bloqueado',
      notes,
    });
  } catch (err) {
    if (err.message === 'appointment_overlap') throw httpErr(409, 'appointment_overlap');
    throw err;
  }

  res.status(201).json(appointment);
}));

router.patch('/:id/cancel', auth, wrap(async (req, res) => {
  const appointment = await Appointment.findOne({
    where: { id: req.params.id, account_id: req.user.account_id },
  });

  if (!appointment) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && appointment.assigned_user_id !== req.user.id) throw httpErr(404, 'not_found');
  if (appointment.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  await appointment.update({ status: 'cancelado' });
  res.json(appointment);
}));

router.patch('/:id/cancel-block', auth, wrap(async (req, res) => {
  const appointment = await Appointment.findOne({
    where: { id: req.params.id, account_id: req.user.account_id, status: 'bloqueado' },
  });

  if (!appointment) throw httpErr(404, 'not_found');
  if (req.user.role === 'staff' && appointment.assigned_user_id !== req.user.id) throw httpErr(403, 'forbidden');

  // Blocks are not historical data — delete the row
  await appointment.destroy();
  res.status(204).end();
}));

router.patch('/:id/correct', auth, wrap(async (req, res) => {
  const appointment = await Appointment.findOne({
    where: { id: req.params.id, account_id: req.user.account_id },
  });

  if (!appointment) throw httpErr(404, 'not_found');
  if (!['completado', 'no_llego'].includes(appointment.status)) throw httpErr(422, 'invalid_status_transition');

  const next = appointment.status === 'completado' ? 'no_llego' : 'completado';
  await appointment.update({ status: next });
  res.json(appointment);
}));

module.exports = router;
