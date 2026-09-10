const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 001 — detalle de un turno (RF-34, RF-43).
export const getAppointment = async (db, { id, accountId, actor }, repos) => {
  const appointment = await repos.appointments.findVisible(db, { id, accountId });
  if (!appointment) throw httpErr(404, 'not_found'); // cross-tenant
  if (actor.role === 'staff' && appointment.assigned_user_id !== actor.id) throw httpErr(404, 'not_found');
  return appointment;
};
