import { createHash, randomInt } from 'crypto';
import { CODE_TTL_MS } from '../../domain/assistant.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

// RF-4: solicitudes de código por teléfono (por IP lo limita la ruta).
export const CODE_REQUESTS_PER_PHONE = 3;
export const CODE_REQUEST_WINDOW_MS = 15 * 60 * 1000;

export const hashCode = (code) => createHash('sha256').update(code).digest('hex');

// spec 011 RF-1, RF-4 — envía un código de 6 dígitos de un solo uso que vence a los 10 minutos.
// La respuesta es idéntica exista o no el cliente: acá ni siquiera se lo busca (se busca o crea al verificar).
// Pedir un código nuevo invalida los anteriores de ese teléfono.
export const startSession = async (db, { accountId, phone, now = new Date() }, repos, sms) => {
  const account = await repos.accounts.findById(db, accountId);
  if (!account) throw httpErr(404, 'not_found');

  const recent = await repos.assistantCodes.countSince(db, { accountId, phone, since: new Date(now.getTime() - CODE_REQUEST_WINDOW_MS) });
  if (recent >= CODE_REQUESTS_PER_PHONE) throw httpErr(429, 'too_many_requests');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await repos.assistantCodes.invalidateActive(db, { accountId, phone });
  await repos.assistantCodes.create(db, {
    account_id: accountId, phone, code_hash: hashCode(code), expires_at: new Date(now.getTime() + CODE_TTL_MS), created_at: now,
  });

  await sms.sendVerificationCode({ to: phone, code, businessName: account.business_name });
  return { message: 'code_sent' };
};
