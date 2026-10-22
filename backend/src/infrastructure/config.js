// spec 008 RF-14, RF-15 — configuración del servidor, validada una vez al arrancar.
// Recibe el entorno como argumento: se prueba sin tocar `process.env`. Falla rápido y nombra la variable;
// el mensaje nunca incluye el valor del secreto.

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Valores de JWT_SECRET de los `.env.example` del repositorio: sirven para desarrollar, nunca en producción.
// Hay un test que exige que esta lista coincida con esos archivos.
export const EXAMPLE_SECRETS = [
  'dev-only-change-me-outside-development', // .env.example (raíz, Docker Compose)
  'change_me_to_a_long_random_string', // backend/.env.example (desarrollo sin Docker)
];

const MIN_PRODUCTION_SECRET_LENGTH = 32;

// Entero decimal sin signo ni espacios ni notación científica.
const parseNonNegativeInt = (name, raw, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) => {
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} debe ser un entero entre ${min} y ${max === Number.MAX_SAFE_INTEGER ? 'el máximo permitido' : max}`);
  }
  return value;
};

export const DEFAULT_APP_URL = 'http://localhost:5173';

// spec 009 RF-22: URL pública del frontend, base de los enlaces de activación. El mensaje nombra la variable, no el valor.
const parseAppUrl = (raw, nodeEnv) => {
  if (raw === undefined || raw === '') return DEFAULT_APP_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('APP_URL debe ser una URL http(s) válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError('APP_URL debe ser una URL http(s) válida');
  if (nodeEnv === 'production' && url.protocol !== 'https:') throw new ConfigError('APP_URL debe usar https:// en producción');
  return raw;
};

export const loadConfig = (env) => {
  const nodeEnv = env.NODE_ENV || 'development';
  const jwtSecret = env.JWT_SECRET ?? '';

  if (jwtSecret.trim() === '') throw new ConfigError('JWT_SECRET es obligatorio y no puede estar vacío');
  if (nodeEnv === 'production') {
    if (jwtSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new ConfigError(`JWT_SECRET debe tener al menos ${MIN_PRODUCTION_SECRET_LENGTH} caracteres en producción`);
    }
    if (EXAMPLE_SECRETS.includes(jwtSecret)) {
      throw new ConfigError('JWT_SECRET es el valor de ejemplo del repositorio: genera uno propio para producción');
    }
  }

  return {
    nodeEnv,
    port: parseNonNegativeInt('PORT', env.PORT, { min: 1, max: 65535, fallback: 3000 }),
    trustProxy: parseNonNegativeInt('TRUST_PROXY', env.TRUST_PROXY, { fallback: 0 }),
    jwtSecret,
    appUrl: parseAppUrl(env.APP_URL, nodeEnv),
  };
};
