import { verifyAssistantToken } from '../jwt.js';

export const SESSION_AUDIENCE = 'assistant-session';

// spec 011 RF-2 — sesión del cliente del asistente. La identidad (cuenta y cliente) sale del token firmado,
// nunca del cuerpo (principio 6). Un JWT del panel no sirve acá: se firma con otra clave.
export default (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });

  try {
    const payload = verifyAssistantToken(header.slice(7), SESSION_AUDIENCE);
    req.assistant = { accountId: payload.account_id, clientId: payload.client_id, sid: payload.sid, exp: payload.exp };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
};
