// Forma de UUID (versión y variante indistintas); evita que un id mal formado llegue a Postgres y dé 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

// spec 008 RF-6, D9: UUID que no corresponde a ningún registro. Un filtro `employee_id` no UUID en pagos se trata como
// "inexistente" (spec 003 RF-4: vacío / ceros) sin que el texto llegue a Postgres, y la respuesta conserva su forma.
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const uuidOrNil = (value) => (value === undefined || isUuid(value) ? value : NIL_UUID);
