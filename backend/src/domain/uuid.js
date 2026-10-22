// Forma de UUID (versión y variante indistintas); evita que un id mal formado llegue a Postgres y dé 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
