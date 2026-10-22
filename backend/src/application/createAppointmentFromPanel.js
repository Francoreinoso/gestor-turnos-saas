import { normalizeEmail } from '../domain/client.js';
import { generateAccessToken } from '../domain/token.js';
import { computeEndsAt, resolveInitialStatus } from '../domain/appointmentScheduling.js';
import { findAvailableProfessional } from './findAvailableProfessional.js';
import { createPayment } from './createPayment.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const isOverlap = (err) => (err.cause?.message ?? err.message) === 'appointment_overlap';

// spec 001 — creación de turnos desde el panel autenticado (RF-1..RF-18).
export const createAppointmentFromPanel = async (
  db,
  { accountId, actor, serviceId, scheduledAt, clientId, clientData, employeeId, notes },
  repos,
) => {
  // RF-4 / RF-15: la forma del payload (presencia, UUID, fecha ISO) la valida el esquema en la ruta.
  const startsAt = new Date(scheduledAt);

  // RF-11 / RF-2 / RF-12: servicio activo de la cuenta y cálculo del fin.
  const service = await repos.services.findActive(db, serviceId, accountId);
  if (!service) throw httpErr(404, 'service_not_found');
  const endsAt = computeEndsAt(startsAt, service.duration_minutes);

  // RF-3 / RF-13: cliente por id (validado contra la cuenta) o find-or-create.
  let resolvedClientId = clientId;
  if (resolvedClientId) {
    const client = await repos.clients.findById(db, resolvedClientId);
    if (!client || client.account_id !== accountId) throw httpErr(404, 'client_not_found');
  } else {
    if (clientData.email) clientData.email = normalizeEmail(clientData.email);
    const client = await repos.clients.findOrCreate(
      db,
      { accountId, email: clientData.email, phone: clientData.phone },
      { account_id: accountId, ...clientData },
    );
    resolvedClientId = client.id;
  }

  // RF-5 / RF-6 / RF-7 / RF-14 / RF-16: resolución del profesional.
  let resolvedUserId;
  if (actor.role === 'staff') {
    resolvedUserId = actor.id; // RF-16: se ignora cualquier profesional recibido
  } else if (employeeId) {
    const user = await repos.users.findById(db, employeeId);
    if (!user || user.account_id !== accountId) throw httpErr(404, 'professional_not_found');
    resolvedUserId = employeeId; // RF-5: sin validar disponibilidad
  } else {
    const professional = await findAvailableProfessional(
      db,
      { accountId, scheduledAt: startsAt, scheduledUntil: endsAt },
      repos,
    );
    if (!professional) throw httpErr(409, 'no_professional_available');
    resolvedUserId = professional.id;
  }

  const status = resolveInitialStatus(endsAt, new Date());
  const row = {
    account_id: accountId,
    client_id: resolvedClientId,
    service_id: serviceId,
    assigned_user_id: resolvedUserId,
    scheduled_at: startsAt,
    scheduled_until: endsAt,
    status,
    notes,
  };

  // RF-9: nace 'completado' → turno + pago en una sola transacción, sin enlace (RF-18).
  if (status === 'completado') {
    try {
      return await db.transaction(async (tx) => {
        const appointment = await repos.appointments.create(tx, row);
        await createPayment(tx, appointment, repos);
        return { appointment };
      });
    } catch (err) {
      if (isOverlap(err)) throw httpErr(409, 'appointment_overlap');
      throw err;
    }
  }

  // RF-1: nace 'agendado' → turno + enlace de autogestión (RF-17).
  let appointment;
  try {
    appointment = await repos.appointments.create(db, row);
  } catch (err) {
    if (isOverlap(err)) throw httpErr(409, 'appointment_overlap');
    throw err;
  }

  const { token, hash } = generateAccessToken();
  await repos.tokens.create(db, {
    appointment_id: appointment.id,
    token_hash: hash,
    expires_at: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
  });

  return { appointment, access_token: token };
};
