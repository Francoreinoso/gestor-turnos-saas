'use strict';

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Appointment } = require('./models');

const app = express();
app.use(express.json());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/appointments', require('./routes/appointments'));
app.use('/services', require('./routes/services'));
app.use('/clients', require('./routes/clients'));
app.use('/availability', require('./routes/availability'));
app.use('/public', require('./routes/public'));

// Global error handler
app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'internal_error' });
});

// Automatic state transitions: agendado → en_progreso → completado
cron.schedule('* * * * *', async () => {
  const now = new Date();
  try {
    await Appointment.update(
      { status: 'en_progreso' },
      { where: { status: 'agendado', scheduled_at: { [Op.lte]: now }, scheduled_until: { [Op.gt]: now } } }
    );
    await Appointment.update(
      { status: 'completado' },
      { where: { status: 'en_progreso', scheduled_until: { [Op.lte]: now } } }
    );
  } catch (err) {
    console.error('cron error:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

module.exports = app;
