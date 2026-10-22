import express from 'express';
import publicRoutes from '../../src/infrastructure/http/routes/public.js';
import availabilityRoutes from '../../src/infrastructure/http/routes/availability.js';
import errorHandler from '../../src/infrastructure/http/middleware/errorHandler.js';

// spec 005 D-P7: servidor Express efímero. app.js arranca el servidor y el cron al importarse,
// así que se montan solo las rutas públicas y el errorHandler extraído.
export async function startPublicServer() {
  const app = express();
  app.use(express.json());
  app.use('/public', publicRoutes);
  app.use('/availability', availabilityRoutes);
  app.use(errorHandler);

  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : null };
  };

  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
