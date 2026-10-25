import { deflateRawSync, inflateRawSync } from 'zlib';
import { signAssistantToken, verifyAssistantToken } from './jwt.js';

// spec 011 — el historial de la conversación (formato normalizado del puerto llmClient) viaja en el cliente,
// comprimido y firmado por el servidor, sin tabla. De ese historial firmado se reconstruyen los slot_id emitidos
// (RF-6, RF-8), así que nadie puede inyectar resultados de herramientas falsos. Va atado a la sesión (`sid`) y vence
// con ella.

const AUDIENCE = 'assistant-conversation';
const MAX_INFLATED_BYTES = 2 * 1024 * 1024;

const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

export const encodeConversation = ({ sid, exp, startedAt, messages }) =>
  signAssistantToken(
    { sid, exp, started_at: startedAt.toISOString(), h: deflateRawSync(Buffer.from(JSON.stringify(messages))).toString('base64url') },
    { audience: AUDIENCE },
  );

// Token ajeno, de otra sesión, vencido o manipulado → 400 invalid_conversation.
export const decodeConversation = (token, sid) => {
  try {
    const payload = verifyAssistantToken(token, AUDIENCE);
    if (payload.sid !== sid) throw new Error('otra sesión');
    const messages = JSON.parse(inflateRawSync(Buffer.from(payload.h, 'base64url'), { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8'));
    if (!Array.isArray(messages)) throw new Error('forma inválida');
    return { startedAt: new Date(payload.started_at), messages };
  } catch {
    throw httpErr(400, 'invalid_conversation');
  }
};
