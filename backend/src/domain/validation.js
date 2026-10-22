// spec 007 — capa de validación: traduce el primer fallo de un esquema Zod al httpErr que consume errorHandler.
// Es el único módulo (junto con domain/schemas/) que conoce la forma de los errores de la librería.

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const RULE_RE = /^(\d{3}):([a-z_][a-z_ ,]*)$/i;

// Valor para el parámetro `error` de un esquema o check de Zod. El estado viaja con la regla
// porque un mismo código tiene estados distintos según el endpoint (invalid_commission_rate: 400 vs 422).
export const rule = (code, status = 400) => `${status}:${code}`;

// RF-2, RF-3: aplica el esquema y lanza un único error determinista (el primer issue, en el orden del esquema).
// Un issue sin regla propia (cuerpo que no es objeto, tipo imprevisto) → 400 invalid_body (RF-10).
// Nunca se expone issue.message de la librería ni el árbol de errores.
export const parseInput = (schema, data) => {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const match = RULE_RE.exec(result.error.issues[0]?.message ?? '');
  if (!match) throw httpErr(400, 'invalid_body');
  throw httpErr(Number(match[1]), match[2]);
};
