export const STATUSES = ['bloqueado', 'agendado', 'en_progreso', 'completado', 'no_llego', 'cancelado'];

// Manual transitions only — automatic ones (agendado→en_progreso→completado) are handled by cron
const VALID_TRANSITIONS = {
  bloqueado: ['cancelado'], // spec 001 RF-46: el bloqueo se libera con baja lógica, nunca DELETE
  agendado: ['cancelado'],
  en_progreso: ['no_llego'],
  completado: ['no_llego'],
  no_llego: ['completado'],
};

export const canTransition = (from, to) => VALID_TRANSITIONS[from]?.includes(to) ?? false;

export const assertTransition = (from, to) => {
  if (!canTransition(from, to)) {
    const err = new Error('invalid_status_transition');
    err.status = 422;
    throw err;
  }
};
