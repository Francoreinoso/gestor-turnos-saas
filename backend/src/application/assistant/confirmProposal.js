import { isUuid } from '../../domain/uuid.js';
import { isExpired } from '../../domain/assistant.js';
import { createAppointment } from '../createAppointment.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const isClientError = (err) => Number.isInteger(err?.status) && err.status >= 400 && err.status < 500;

const summary = (appointment) => ({
  id: appointment.id, scheduled_at: appointment.scheduled_at, scheduled_until: appointment.scheduled_until, status: appointment.status,
});

// spec 011 RF-11..RF-13 — el cliente confirma una propuesta con el botón de la interfaz, sin pasar por el modelo.
// Idempotente: la fila de la propuesta se bloquea y confirmar dos veces devuelve el mismo turno sin duplicarlo.
// Ajena o inexistente → 404; vencida → 409 proposal_expired; descartada → 409 proposal_discarded.
// Si el turno no se puede crear (horario tomado: 409 appointment_overlap) la propuesta queda descartada.
export const confirmProposal = async (db, { accountId, clientId, proposalId, now = new Date() }, repos) => {
  if (!isUuid(proposalId)) throw httpErr(404, 'not_found');

  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const proposal = await repos.assistantProposals.lockForClient(tx, { id: proposalId, accountId, clientId });
      if (!proposal) throw httpErr(404, 'not_found');
      if (proposal.status === 'confirmada') {
        const appointment = await repos.appointments.findById(tx, proposal.appointment_id);
        return { created: false, appointment };
      }
      if (proposal.status === 'descartada') throw httpErr(409, 'proposal_discarded');
      // El cambio a 'vencida' se escribe fuera de la transacción: un throw acá lo desharía.
      if (proposal.status === 'vencida' || isExpired(proposal, now)) return { expired: true };

      const { appointment, access_token } = await createAppointment(tx, {
        accountId, serviceId: proposal.service_id, scheduledAt: proposal.starts_at,
        clientId, employeeId: proposal.employee_id, now,
      }, repos);
      await repos.assistantProposals.markConfirmed(tx, proposal.id, appointment.id);
      return { created: true, appointment, access_token };
    });
  } catch (err) {
    // La transacción ya se deshizo; si el turno no pudo crearse por una regla de negocio, la propuesta no sirve más.
    const knownProposalErrors = ['not_found', 'proposal_discarded'];
    if (isClientError(err) && !knownProposalErrors.includes(err.message)) {
      await repos.assistantProposals.markStatus(db, proposalId, 'descartada');
    }
    throw err;
  }

  if (outcome.expired) {
    await repos.assistantProposals.markStatus(db, proposalId, 'vencida');
    throw httpErr(409, 'proposal_expired');
  }

  return {
    created: outcome.created,
    proposal_id: proposalId,
    appointment: summary(outcome.appointment),
    // Enlace de gestión (spec 005): solo existe en la primera confirmación; el token no se guarda en claro.
    ...(outcome.access_token ? { access_token: outcome.access_token } : {}),
  };
};
