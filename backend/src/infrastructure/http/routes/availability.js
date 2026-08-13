import express from 'express';
import { eq, and, ne, lt, gt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serviceRepo } from '../../db/repositories/services.js';
import { userRepo } from '../../db/repositories/users.js';
import { appointments } from '../../../../db/schema.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.get('/:business_id', wrap(async (req, res) => {
  const { business_id } = req.params;
  const { employee_id, service_id, date_from, date_to } = req.query;

  if (!date_from || !date_to || !service_id) throw httpErr(400, 'date_from, date_to, service_id required');

  const service = await serviceRepo.findActive(db, service_id, business_id);
  if (!service) throw httpErr(404, 'service_not_found');

  const from = new Date(date_from);
  const to = new Date(date_to);

  const usersWithAvailability = await userRepo.findWithAvailability(db, business_id, employee_id);

  const takenSlots = await db.query.appointments.findMany({
    where: and(
      eq(appointments.account_id, business_id),
      ne(appointments.status, 'cancelado'),
      lt(appointments.scheduled_at, to),
      gt(appointments.scheduled_until, from),
    ),
    columns: { assigned_user_id: true, scheduled_at: true, scheduled_until: true },
  });

  const durationMs = service.duration_minutes * 60 * 1000;
  const slots = [];

  // ponytail: O(windows × taken_slots) — fine for day-range queries; add index if slow
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();

    for (const user of usersWithAvailability) {
      const windows = user.availability?.filter(a => a.day_of_week === dow) ?? [];

      for (const window of windows) {
        const [sh, sm] = window.start_time.split(':').map(Number);
        const [eh, em] = window.end_time.split(':').map(Number);

        const windowStart = new Date(d);
        windowStart.setHours(sh, sm, 0, 0);
        const windowEnd = new Date(d);
        windowEnd.setHours(eh, em, 0, 0);

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

export default router;
