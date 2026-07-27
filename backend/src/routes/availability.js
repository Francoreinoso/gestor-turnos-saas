'use strict';

const router = require('express').Router();
const { Op } = require('sequelize');
const { User, Availability, Appointment, Service } = require('../models');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.get('/:business_id', wrap(async (req, res) => {
  const { business_id } = req.params;
  const { employee_id, service_id, date_from, date_to } = req.query;

  if (!date_from || !date_to || !service_id) throw httpErr(400, 'date_from, date_to, service_id required');

  const service = await Service.findOne({ where: { id: service_id, account_id: business_id, active: true } });
  if (!service) throw httpErr(404, 'service_not_found');

  const from = new Date(date_from);
  const to = new Date(date_to);

  // Get relevant users' availability windows
  const userWhere = { account_id: business_id };
  if (employee_id) userWhere.id = employee_id;

  const users = await User.findAll({
    where: userWhere,
    include: [{ model: Availability }],
  });

  // Get existing appointments in range (excluding cancelled)
  const takenSlots = await Appointment.findAll({
    where: {
      account_id: business_id,
      status: { [Op.ne]: 'cancelado' },
      scheduled_at: { [Op.lt]: to },
      scheduled_until: { [Op.gt]: from },
    },
    attributes: ['assigned_user_id', 'scheduled_at', 'scheduled_until'],
  });

  const durationMs = service.duration_minutes * 60 * 1000;
  const slots = [];

  // Iterate each day in range and each user's availability windows
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();

    for (const user of users) {
      const windows = user.Availabilities?.filter(a => a.day_of_week === dow) ?? [];

      for (const window of windows) {
        const [sh, sm] = window.start_time.split(':').map(Number);
        const [eh, em] = window.end_time.split(':').map(Number);

        const windowStart = new Date(d);
        windowStart.setHours(sh, sm, 0, 0);
        const windowEnd = new Date(d);
        windowEnd.setHours(eh, em, 0, 0);

        // ponytail: O(windows × taken_slots) — fine for day-range queries; add index if slow
        for (let slotStart = windowStart; slotStart.getTime() + durationMs <= windowEnd.getTime(); slotStart = new Date(slotStart.getTime() + durationMs)) {
          const slotEnd = new Date(slotStart.getTime() + durationMs);

          const isTaken = takenSlots.some(appt =>
            (appt.assigned_user_id === user.id || appt.assigned_user_id === null) &&
            appt.scheduled_at < slotEnd &&
            appt.scheduled_until > slotStart
          );

          if (!isTaken) {
            slots.push({ employee_id: user.id, starts_at: slotStart.toISOString(), ends_at: slotEnd.toISOString() });
          }
        }
      }
    }
  }

  res.json(slots);
}));

module.exports = router;
