import 'dotenv/config';
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
import errorHandler from './middleware/errorHandler.js';
import { startCron } from '../integrations/cron.js';

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

startCron();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

export default app;
