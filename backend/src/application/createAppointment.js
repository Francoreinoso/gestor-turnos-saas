import { normalizeEmail } from '../domain/client.js';
import { generateAccessToken } from '../domain/token.js';
import { assertScheduledAtNotPast } from '../domain/appointmentScheduling.js';
import { findAvailableProfessional } from './findAvailableProfessional.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// Caso de uso exclusivo del booking público y la reprogramación: no admite inicios en el pasado (spec 005 RF-10).
// El panel usa createAppointmentFromPanel, que conserva el permiso de cargar turnos pasados.
export const createAppointment = async (db, { accountId, serviceId, scheduledAt, clientData, clientId, employeeId, notes, now = new Date() }, repos) => {
  const start = assertScheduledAtNotPast(scheduledAt, now);

  const service = await repos.services.findActive(db, serviceId, accountId);
  if (!service) throw httpErr(404, 'service_not_found');

  const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);

  let resolvedClientId = clientId;
  if (!resolvedClientId) {
    if (!clientData) throw httpErr(400, 'client_required');
    if (clientData.email) clientData.email = normalizeEmail(clientData.email);

    const client = await repos.clients.findOrCreate(
      db,
      { accountId, email: clientData.email, phone: clientData.phone },
      { account_id: accountId, ...clientData }
    );
    resolvedClientId = client.id;
  }

  let resolvedUserId = employeeId;
  if (!resolvedUserId) {
    const professional = await findAvailableProfessional(db, { accountId, scheduledAt: start, scheduledUntil: end }, repos);
    if (!professional) throw httpErr(409, 'no_professional_available');
    resolvedUserId = professional.id;
  }

  let appointment;
  try {
    appointment = await repos.appointments.create(db, {
      account_id: accountId,
      client_id: resolvedClientId,
      service_id: serviceId,
      assigned_user_id: resolvedUserId,
      scheduled_at: start,
      scheduled_until: end,
      status: 'agendado',
      notes,
    });
  } catch (err) {
    // Drizzle wraps pg errors: real message lives in err.cause
    if ((err.cause?.message ?? err.message) === 'appointment_overlap') {
      throw httpErr(409, 'appointment_overlap');
    }
    throw err;
  }

  const { token, hash } = generateAccessToken();
  // ponytail: expires 2h before appointment — product can tune this threshold
  const expiresAt = new Date(start.getTime() - 2 * 60 * 60 * 1000);

  await repos.tokens.create(db, {
    appointment_id: appointment.id,
    token_hash: hash,
    expires_at: expiresAt,
  });

  return { appointment, access_token: token };
};
