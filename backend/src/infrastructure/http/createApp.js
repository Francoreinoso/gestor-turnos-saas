import express from 'express';
import accountRoutes from './routes/accounts.js';
import authRoutes from './routes/auth.js';
import appointmentRoutes from './routes/appointments.js';
import serviceRoutes from './routes/services.js';
import clientRoutes from './routes/clients.js';
import availabilityRoutes from './routes/availability.js';
import publicRoutes from './routes/public.js';
import staffRoutes from './routes/staff.js';
import meRoutes from './routes/me.js';
import paymentRoutes from './routes/payments.js';
import healthRoutes from './routes/health.js';
import errorHandler from './middleware/errorHandler.js';
import securityHeaders from './middleware/securityHeaders.js';

// spec 008 D-P1: tabla única de rutas. La aplicación y los tests montan lo mismo, y la prueba que exige
// que ninguna ruta con parámetro de id responda 500 ante un valor no UUID la recorre.
export const ROUTES = [
  ['/accounts', accountRoutes],
  ['/auth', authRoutes],
  ['/appointments', appointmentRoutes],
  ['/services', serviceRoutes],
  ['/clients', clientRoutes],
  ['/availability', availabilityRoutes],
  ['/public', publicRoutes],
  ['/staff', staffRoutes],
  ['/me', meRoutes],
  ['/payments', paymentRoutes],
];

// Aplicación sin `listen` ni cron: app.js la arranca; los tests la montan en un puerto efímero.
export const createApp = ({ trustProxy = 0 } = {}) => {
  const app = express();
  app.disable('x-powered-by'); // spec 008 RF-16
  app.set('trust proxy', trustProxy); // spec 008 RF-10: IP real del cliente detrás de nginx
  app.use(securityHeaders); // spec 008 RF-16: antes que todo, para que también las lleven los errores
  app.use(express.json());

  // spec 006 RF-15: sin auth ni limitador, lo consulta el orquestador con frecuencia.
  app.use('/health', healthRoutes);
  for (const [path, router] of ROUTES) app.use(path, router);

  app.use(errorHandler);
  return app;
};
