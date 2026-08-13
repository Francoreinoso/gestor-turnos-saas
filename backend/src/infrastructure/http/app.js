import 'dotenv/config';
import express from 'express';
import authRoutes from './routes/auth.js';
import appointmentRoutes from './routes/appointments.js';
import serviceRoutes from './routes/services.js';
import clientRoutes from './routes/clients.js';
import availabilityRoutes from './routes/availability.js';
import publicRoutes from './routes/public.js';
import { startCron } from '../integrations/cron.js';

const app = express();
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/services', serviceRoutes);
app.use('/clients', clientRoutes);
app.use('/availability', availabilityRoutes);
app.use('/public', publicRoutes);

app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'internal_error' });
});

startCron();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

export default app;
