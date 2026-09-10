const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// spec 001 — baja lógica de un bloqueo (RF-32, RF-46..RF-48). Nunca DELETE físico.
export const cancelBlock = async (db, { id, accountId, actor }, repos) => {
  const block = await repos.appointments.findVisible(db, { id, accountId });
  if (!block) throw httpErr(404, 'not_found'); // RF-47 (inexistente) / RF-48 (otra cuenta)

  // RF-32 / RF-48: un staff solo toca bloqueos propios; el de negocio (assigned_user_id NULL) no es suyo.
  if (actor.role === 'staff' && block.assigned_user_id !== actor.id) throw httpErr(404, 'not_found');

  // RF-47: existe pero no es un bloqueo, o ya está cancelado.
  if (block.status !== 'bloqueado') throw httpErr(422, 'invalid_status_transition');

  return repos.appointments.update(db, id, { status: 'cancelado' }); // RF-46
};
