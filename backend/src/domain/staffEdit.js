// Políticas de payload para la gestión de trabajadores (spec 002).

const badField = () => {
  const err = new Error('invalid_field');
  err.status = 400;
  throw err;
};

const emptyUpdate = () => {
  const err = new Error('empty_update');
  err.status = 400;
  throw err;
};

// RF-4: null siempre es válido (limpia la comisión propia, RF-19); fuera de [0,1] → 422.
export const assertValidCommissionRate = (rate) => {
  if (rate === null || rate === undefined) return;
  if (typeof rate !== 'number' || rate < 0 || rate > 1) {
    const err = new Error('invalid_commission_rate');
    err.status = 422;
    throw err;
  }
};

const buildEditablePayload = (body, fields, nullable) => {
  const keys = Object.keys(body);
  for (const key of keys) {
    if (!fields.includes(key)) badField();
    if (body[key] === null && !nullable.has(key)) badField();
    if (body[key] === undefined) badField();
  }

  const changes = {};
  for (const key of fields) {
    if (key in body) changes[key] = body[key];
  }

  if (Object.keys(changes).length === 0) emptyUpdate();
  return changes;
};

// RF-16, RF-19, RF-23: el owner edita nombre, email y/o comisión propia (null la limpia).
const OWNER_EDITABLE_FIELDS = ['name', 'email', 'commission_rate'];
const OWNER_NULLABLE = new Set(['commission_rate']);
export const assertOwnerEditablePayload = (body = {}) =>
  buildEditablePayload(body, OWNER_EDITABLE_FIELDS, OWNER_NULLABLE);

// RF-20, RF-21: cualquier usuario edita su propio nombre y contraseña; nunca email/rol/comisión.
const SELF_EDITABLE_FIELDS = ['name', 'password'];
export const assertSelfEditablePayload = (body = {}) =>
  buildEditablePayload(body, SELF_EDITABLE_FIELDS, new Set());
