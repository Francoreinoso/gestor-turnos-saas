import express from 'express';
import jwt from 'jsonwebtoken';
import accountRoutes from '../../src/infrastructure/http/routes/accounts.js';
import authRoutes from '../../src/infrastructure/http/routes/auth.js';
import appointmentRoutes from '../../src/infrastructure/http/routes/appointments.js';
import serviceRoutes from '../../src/infrastructure/http/routes/services.js';
import clientRoutes from '../../src/infrastructure/http/routes/clients.js';
import availabilityRoutes from '../../src/infrastructure/http/routes/availability.js';
import publicRoutes from '../../src/infrastructure/http/routes/public.js';
import staffRoutes from '../../src/infrastructure/http/routes/staff.js';
import meRoutes from '../../src/infrastructure/http/routes/me.js';
import paymentRoutes from '../../src/infrastructure/http/routes/payments.js';
import errorHandler from '../../src/infrastructure/http/middleware/errorHandler.js';

process.env.JWT_SECRET ??= 'test-secret';

export const tokenFor = (user) =>
  jwt.sign({ id: user.id, account_id: user.account_id, role: user.role }, process.env.JWT_SECRET);

// spec 007: servidor Express efímero con todas las rutas (app.js arranca cron y puerto al importarse).
// `body` se manda tal cual como JSON (incluidos null, arrays y strings); `undefined` = sin cuerpo.
export async function startApiServer() {
  const app = express();
  app.use(express.json());
  app.use('/accounts', accountRoutes);
  app.use('/auth', authRoutes);
  app.use('/appointments', appointmentRoutes);
  app.use('/services', serviceRoutes);
  app.use('/clients', clientRoutes);
  app.use('/availability', availabilityRoutes);
  app.use('/public', publicRoutes);
  app.use('/staff', staffRoutes);
  app.use('/me', meRoutes);
  app.use('/payments', paymentRoutes);
  app.use(errorHandler);

  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body, token) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}
