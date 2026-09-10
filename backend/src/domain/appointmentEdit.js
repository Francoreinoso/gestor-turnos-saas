// Política de edición in-place de un turno (spec 001, RF-19..RF-22).
// Solo se pueden editar estos campos; cambiar la fecha/hora es reprogramar (fuera de alcance).

const NULLABLE = new Set(['notes']); // notes admite null/'' para limpiarse; el resto no
const EDITABLE_FIELDS = ['notes', 'service_id', 'client_id', 'assigned_user_id'];

const badField = () => {
  const err = new Error('invalid_field');
  err.status = 400;
  throw err;
};

// Devuelve el subconjunto de cambios a aplicar; lanza 400 si el payload es inválido o vacío.
export const assertEditablePayload = (body = {}) => {
  const keys = Object.keys(body);

  for (const key of keys) {
    if (!EDITABLE_FIELDS.includes(key)) badField();
    if (body[key] === null && !NULLABLE.has(key)) badField();
    if (body[key] === undefined) badField();
  }

  const changes = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) changes[key] = body[key];
  }

  if (Object.keys(changes).length === 0) {
    const err = new Error('empty_update');
    err.status = 400;
    throw err;
  }

  return changes;
};
