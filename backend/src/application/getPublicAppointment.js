const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 005 RF-5, RF-6 — consulta de un turno por su enlace de gestión. Corre después de publicAuth.
// RF-6: lista blanca; `client` y `notes` que trae findVisible nunca se copian a la respuesta.
export const getPublicAppointment = async (db, { id }, repos) => {
  const base = await repos.appointments.findById(db, id);
  if (!base) throw httpErr(404, 'not_found');

  const appointment = await repos.appointments.findVisible(db, { id, accountId: base.account_id });
  if (!appointment) throw httpErr(404, 'not_found');

  const account = await repos.accounts.findById(db, base.account_id);

  const { service, assignedUser } = appointment;
  return {
    id: appointment.id,
    account_id: base.account_id, // el frontend lo necesita para consultar horarios al reprogramar (spec 005 D10)
    status: appointment.status,
    scheduled_at: appointment.scheduled_at,
    scheduled_until: appointment.scheduled_until,
    service: service
      ? { id: service.id, name: service.name, duration_minutes: service.duration_minutes, price: service.price }
      : null,
    professional: assignedUser ? { id: assignedUser.id, name: assignedUser.name } : null,
    business_name: account?.business_name ?? null,
  };
};
