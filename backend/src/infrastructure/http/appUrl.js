import { DEFAULT_APP_URL } from '../config.js';

// spec 009 RF-22 — misma idea que jwt.js: el entorno se lee en cada llamada; `loadConfig` ya lo validó al arrancar.
export const getAppUrl = () => process.env.APP_URL || DEFAULT_APP_URL;
