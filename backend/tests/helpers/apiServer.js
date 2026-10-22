import jwt from 'jsonwebtoken';
import { createApp } from '../../src/infrastructure/http/createApp.js';

process.env.JWT_SECRET ??= 'test-secret';

export const tokenFor = (user) =>
  jwt.sign({ id: user.id, account_id: user.account_id, role: user.role }, process.env.JWT_SECRET);

// spec 007: servidor Express efímero con todas las rutas (app.js arranca cron y puerto al importarse).
// `body` se manda tal cual como JSON (incluidos null, arrays y strings); `undefined` = sin cuerpo.
export async function startApiServer({ trustProxy = 1 } = {}) {
  const app = createApp({ trustProxy });
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  // spec 008 D-P7: cada llamada manda un X-Forwarded-For distinto por defecto, así los tests que no hablan de límites
  // nunca comparten cupo de login, registro ni /public/* (los limitadores cuentan por IP y viven en memoria del proceso).
  // `opts.ip` fija una IP para simular a un mismo cliente repitiendo solicitudes; `opts.headers` agrega cabeceras.
  const randomIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

  const call = async (method, path, body, token, opts = {}) => {
    const headers = { 'x-forwarded-for': opts.ip ?? randomIp(), ...opts.headers };
    if (body !== undefined && !('content-type' in headers)) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const raw = opts.raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const res = await fetch(base + path, { method, headers, body: raw });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* cuerpo no JSON */ }
    return { status: res.status, body: parsed, text, headers: res.headers };
  };

  return { call, base, close: () => new Promise(resolve => server.close(resolve)) };
}
