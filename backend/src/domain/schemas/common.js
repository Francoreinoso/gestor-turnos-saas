// spec 007 — bloques reutilizables de esquema. Puro: solo Zod y reglas de dominio, sin I/O.
import { z } from 'zod';
import { rule } from '../validation.js';
import { isUuid } from '../uuid.js';
import { PHONE_REGEX } from '../client.js';

// Ausente (undefined/null) → código de ausencia; presente con tipo incorrecto → código del campo (D7).
export const typeError = (missing, wrong = 'invalid_body', status = 400) =>
  (iss) => rule(iss.input == null ? missing : wrong, status);

// Texto obligatorio y recortado: vacío, solo espacios o ausente → missing_fields.
export const requiredText = ({ wrong = 'invalid_body' } = {}) =>
  z.string({ error: typeError('missing_fields', wrong) }).trim().min(1, rule('missing_fields'));

// Texto obligatorio sin recortar (password, token): los espacios son válidos.
export const requiredRaw = ({ wrong = 'invalid_body' } = {}) =>
  z.string({ error: typeError('missing_fields', wrong) }).min(1, rule('missing_fields'));

// spec 008 RF-11: contraseña nueva de 8 caracteres a 72 bytes UTF-8 (bcrypt trunca en silencio lo que pasa de 72 bytes).
// Sin recortar. El login NO aplica esta regla: los usuarios existentes con contraseñas más cortas siguen entrando.
const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_BYTES = 72;
const utf8 = new TextEncoder();
export const passwordInRange = (value) =>
  [...value].length >= PASSWORD_MIN_CHARS && utf8.encode(value).length <= PASSWORD_MAX_BYTES;

export const newPassword = ({ wrong = 'invalid_body' } = {}) =>
  requiredRaw({ wrong }).refine(passwordInRange, rule('invalid_password'));

// Email obligatorio: solo minúsculas (mismo resultado que normalizeEmail), sin recortar.
export const requiredEmail = () =>
  z.string({ error: typeError('missing_fields') }).min(1, rule('missing_fields')).toLowerCase();

// Texto opcional recortado: ausente → undefined; null se conserva (RF-13).
export const optionalText = ({ wrong = 'invalid_body' } = {}) =>
  z.string({ error: rule(wrong) }).trim().nullish();

// Mismo criterio de UUID que domain/uuid.js. `missing` solo aplica si el campo es obligatorio.
export const uuidField = ({ missing = 'missing_fields', wrong = 'invalid_body' } = {}) =>
  z.string({ error: typeError(missing, wrong) })
    .refine(isUuid, { error: (iss) => rule(iss.input === '' ? missing : wrong) });

export const optionalUuid = ({ wrong = 'invalid_body' } = {}) =>
  z.string({ error: rule(wrong) }).refine(isUuid, rule(wrong)).optional();

export const isValidDate = (value) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

// Fecha como string (los casos de uso siguen haciendo `new Date`, D-P3). `check: false` solo exige string.
export const isoDate = ({ invalid = 'invalid_date', check = true } = {}) => {
  const base = z.string({ error: typeError('missing_fields', invalid) }).min(1, rule('missing_fields'));
  return check ? base.refine(isValidDate, rule(invalid)) : base;
};

// Teléfono E.164 básico; '' equivale a "no enviado" como hoy (`phone || null`).
export const phone = () =>
  z.string({ error: rule('invalid_phone_format') })
    .refine((v) => v === '' || PHONE_REGEX.test(v), rule('invalid_phone_format'))
    .nullish();

// Comisión: número en [0,1] o null. `status` según el endpoint (400 en accounts, 422 en staff).
export const commissionRate = (status) => {
  const err = rule('invalid_commission_rate', status);
  return z.number({ error: err }).min(0, err).max(1, err).nullable();
};

// Cliente anidado de un turno: lista blanca (RF-11, D-P5) — account_id u otras claves nunca llegan al repositorio.
export const clientData = () =>
  z.object({
    name: requiredText(),
    email: z.string({ error: rule('invalid_body') }).toLowerCase().nullish(),
    phone: phone(),
    notes: optionalText(),
  }, { error: rule('invalid_body') });

// Esquema de edición estricto (RF-11, D-P7): campo desconocido o null donde no se admite → invalid_field;
// objeto vacío → empty_update. Esas reglas corren primero (en ese orden) y recién después los tipos de cada campo.
export const editSchema = (shape, { nullable = [] } = {}) => {
  const allowed = Object.keys(shape);
  const nullableSet = new Set(nullable);
  const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

  return z.record(z.string(), z.unknown())
    .refine((o) => Object.entries(o).every(([k, v]) => allowed.includes(k) && v !== undefined && (v !== null || nullableSet.has(k))), rule('invalid_field'))
    .refine((o) => !isPlain(o) || Object.keys(o).length > 0, rule('empty_update'))
    .pipe(z.object(shape).partial());
};
