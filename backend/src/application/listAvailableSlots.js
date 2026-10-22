const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// Horarios libres de un servicio en [from, to). Lógica extraída de routes/availability.js (spec 005 D-P1).
// RF-9: nunca incluye slots cuyo inicio sea <= now. Las ventanas se calculan en hora local del servidor.
export const listAvailableSlots = async (db, { businessId, serviceId, employeeId, from, to, now = new Date() }, repos) => {
  const service = await repos.services.findActive(db, serviceId, businessId);
  if (!service) throw httpErr(404, 'service_not_found');

  const usersWithAvailability = await repos.users.findWithAvailability(db, businessId, employeeId);
  const takenSlots = await repos.appointments.findTakenSlots(db, { accountId: businessId, from, to });

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
          if (slotStart.getTime() <= now.getTime()) continue;

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

  return slots;
};
