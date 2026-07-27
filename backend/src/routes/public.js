'use strict';

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { Appointment } = require('../models');
const publicAuth = require('../middleware/publicAuth');
const { createAppointment } = require('../utils/appointment');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// ponytail: 20 req/15min per IP — tighten if brute-force becomes a concern
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { error: 'too_many_requests' } });

router.use(limiter);

router.patch('/appointments/:id/cancel', publicAuth, wrap(async (req, res) => {
  const appointment = await Appointment.findByPk(req.params.id);
  if (!appointment || appointment.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  await appointment.update({ status: 'cancelado' });
  res.json({ message: 'appointment_cancelled' });
}));

router.patch('/appointments/:id/reschedule', publicAuth, wrap(async (req, res) => {
  const { service_id, scheduled_at, employee_id, notes } = req.body;
  if (!scheduled_at) throw httpErr(400, 'missing_fields');

  const old = await Appointment.findByPk(req.params.id);
  if (!old || old.status !== 'agendado') throw httpErr(422, 'invalid_status_transition');

  const result = await Appointment.sequelize.transaction(async (t) => {
    await old.update({ status: 'cancelado' }, { transaction: t });

    return createAppointment({
      accountId: old.account_id,
      serviceId: service_id || old.service_id,
      scheduledAt: scheduled_at,
      clientId: old.client_id,
      employeeId: employee_id || old.assigned_user_id,
      notes: notes ?? old.notes,
      t,
    });
  });

  res.status(201).json(result);
}));

module.exports = router;
