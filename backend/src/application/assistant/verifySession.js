import { timingSafeEqual } from 'crypto';
import { CODE_MAX_ATTEMPTS } from '../../domain/assistant.js';
import { hashCode } from './startSession.js';

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// spec 011 RF-2, RF-3 — verifica el código y devuelve la identidad de la sesión. El cliente se busca o crea por
// teléfono dentro de la cuenta. Código incorrecto, vencido o usado → 401 invalid_code (indistinguibles);
// el quinto fallo invalida el código.
export const verifySession = async (db, { accountId, phone, code, now = new Date() }, repos) => {
  const record = await repos.assistantCodes.findActive(db, { accountId, phone, now });
  if (!record) throw httpErr(401, 'invalid_code');

  if (!sameHash(hashCode(code), record.code_hash)) {
    await repos.assistantCodes.registerFailure(db, record.id, CODE_MAX_ATTEMPTS);
    throw httpErr(401, 'invalid_code');
  }
  // Un solo uso aun con dos verificaciones simultáneas.
  if (!await repos.assistantCodes.consume(db, record.id)) throw httpErr(401, 'invalid_code');

  // Sin nombre conocido: el teléfono hace de nombre hasta que el negocio lo edite desde el panel.
  const client = await repos.clients.findOrCreate(db, { accountId, phone }, { account_id: accountId, name: phone, phone });
  return { accountId, clientId: client.id };
};
