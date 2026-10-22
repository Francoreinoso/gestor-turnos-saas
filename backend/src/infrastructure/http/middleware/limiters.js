import rateLimit from 'express-rate-limit';

// spec 008 RF-8, RF-9, RF-10 — límites de uso por IP, con contador en memoria por proceso (no se comparten entre réplicas).
// La IP la resuelve Express según `trust proxy` (config TRUST_PROXY): detrás de nginx es la del cliente real.
// Fábrica con tope y ventana parametrizables para poder probarlos con valores chicos.
const MINUTE_MS = 60 * 1000;

export const createLimiter = ({ windowMs, limit, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests, // cuenta solo las respuestas 4xx/5xx
    standardHeaders: 'draft-7', // RateLimit-* y Retry-After al bloquear
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
  });

// RF-8: 10 intentos fallidos de login cada 15 minutos por IP; los exitosos no cuentan.
export const loginLimiter = createLimiter({ windowMs: 15 * MINUTE_MS, limit: 10, skipSuccessfulRequests: true });

// RF-9: 5 solicitudes de registro por hora por IP (cuentan todas).
export const registerLimiter = createLimiter({ windowMs: 60 * MINUTE_MS, limit: 5 });

// spec 005 RF-8, D9: /public/* — estricto para escrituras y activación (frena fuerza bruta sobre tokens), holgado para lecturas.
export const strictLimiter = createLimiter({ windowMs: 15 * MINUTE_MS, limit: 20 });
export const readLimiter = createLimiter({ windowMs: 15 * MINUTE_MS, limit: 120 });
