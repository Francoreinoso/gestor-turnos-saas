export const STATUSES = ['pendiente', 'activo', 'inactivo'];

const VALID_TRANSITIONS = {
  pendiente: ['activo', 'inactivo'],
  activo: ['inactivo'],
  inactivo: ['pendiente'],
};

export const canTransition = (from, to) => VALID_TRANSITIONS[from]?.includes(to) ?? false;

export const assertTransition = (from, to) => {
  if (!canTransition(from, to)) {
    const err = new Error('invalid_status_transition');
    err.status = 422;
    throw err;
  }
};
