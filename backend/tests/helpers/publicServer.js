import { createApp } from '../../src/infrastructure/http/createApp.js';

// spec 005 D-P7: servidor Express efímero. app.js arranca el servidor y el cron al importarse;
// spec 008 D-P1: se monta la misma aplicación (createApp) que usa el servidor real.
export async function startPublicServer() {
  const app = createApp();

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
