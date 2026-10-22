import jwt from 'jsonwebtoken';

// spec 008 RF-13 — único lugar que firma y verifica JWT. El algoritmo se fija explícitamente en ambos extremos:
// con `algorithms` en la verificación, un token con `alg: none` o con otro algoritmo se rechaza aunque lleve firma.
// El secreto se lee en cada llamada (no al importar): la configuración ya lo validó al arrancar (RF-14).
const ALGORITHM = 'HS256';

export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn: '7d' });

export const verifyToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITHM] });
