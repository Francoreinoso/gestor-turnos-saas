import jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';

// spec 008 RF-13 — único lugar que firma y verifica JWT. El algoritmo se fija explícitamente en ambos extremos:
// con `algorithms` en la verificación, un token con `alg: none` o con otro algoritmo se rechaza aunque lleve firma.
// El secreto se lee en cada llamada (no al importar): la configuración ya lo validó al arrancar (RF-14).
const ALGORITHM = 'HS256';

export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn: '7d' });

export const verifyToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITHM] });

// spec 011 — tokens del asistente (sesión del cliente y estado firmado de la conversación). Se firman con una clave
// derivada de JWT_SECRET: un token del asistente no sirve en el panel ni uno del panel acá. La audiencia distingue
// la sesión del estado de la conversación.
const assistantKey = () => createHmac('sha256', process.env.JWT_SECRET).update('assistant-tokens').digest();

// `expiresIn` es opcional: el estado de la conversación hereda el `exp` de la sesión dentro del payload.
export const signAssistantToken = (payload, { audience, expiresIn }) =>
  jwt.sign(payload, assistantKey(), { algorithm: ALGORITHM, audience, ...(expiresIn ? { expiresIn } : {}) });

export const verifyAssistantToken = (token, audience) =>
  jwt.verify(token, assistantKey(), { algorithms: [ALGORITHM], audience });
