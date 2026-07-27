'use strict';

const { Op } = require('sequelize');
const { Appointment, Service, Client, User, Availability, AppointmentAccessToken } = require('../models');
const { generateAccessToken } = require('./token');

// ponytail: O(n) over professionals — acceptable for typical business size (< 20 staff)
const findAvailableProfessional = async (accountId, scheduledAt, scheduledUntil) => {
  const dayOfWeek = scheduledAt.getDay();
  const startTime = scheduledAt.toTimeString().slice(0, 8); // HH:MM:SS
  const endTime = scheduledUntil.toTimeString().slice(0, 8);

  // Business-wide block takes precedence — if one exists, nobody is available
  const businessBlock = await Appointment.findOne({
    where: {
      account_id: accountId,
      assigned_user_id: null,
      status: { [Op.ne]: 'cancelado' },
      scheduled_at: { [Op.lt]: scheduledUntil },
      scheduled_until: { [Op.gt]: scheduledAt },
    },
  });
  if (businessBlock) return null;

  const candidates = await User.findAll({
    where: { account_id: accountId },
    include: [{
      model: Availability,
      where: {
        day_of_week: dayOfWeek,
        start_time: { [Op.lte]: startTime },
        end_time: { [Op.gte]: endTime },
      },
      required: true,
    }],
  });

  for (const user of candidates) {
    const conflict = await Appointment.findOne({
      where: {
        account_id: accountId,
        assigned_user_id: user.id,
        status: { [Op.ne]: 'cancelado' },
        scheduled_at: { [Op.lt]: scheduledUntil },
        scheduled_until: { [Op.gt]: scheduledAt },
      },
    });
    if (!conflict) return user;
  }

  return null;
};

const createAppointment = async ({ accountId, serviceId, scheduledAt, clientData, clientId, employeeId, notes, t }) => {
  const service = await Service.findOne({ where: { id: serviceId, account_id: accountId, active: true } });
  if (!service) throw Object.assign(new Error('service_not_found'), { status: 404 });

  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + service.duration_minutes * 60 * 1000);

  let resolvedClientId = clientId;
  if (!resolvedClientId) {
    if (!clientData) throw Object.assign(new Error('client_required'), { status: 400 });

    // Normalize email before lookup/create to prevent duplicates from casing differences
    if (clientData.email) clientData.email = clientData.email.toLowerCase();

    const [client] = await Client.findOrCreate({
      where: clientData.email
        ? { account_id: accountId, email: clientData.email }
        : { account_id: accountId, phone: clientData.phone },
      defaults: { account_id: accountId, ...clientData },
      transaction: t,
    });
    resolvedClientId = client.id;
  }

  let resolvedUserId = employeeId;
  if (!resolvedUserId) {
    const professional = await findAvailableProfessional(accountId, start, end);
    if (!professional) throw Object.assign(new Error('no_professional_available'), { status: 409 });
    resolvedUserId = professional.id;
  }

  let appointment;
  try {
    appointment = await Appointment.create({
      account_id: accountId,
      client_id: resolvedClientId,
      service_id: serviceId,
      assigned_user_id: resolvedUserId,
      scheduled_at: start,
      scheduled_until: end,
      status: 'agendado',
      notes,
    }, { transaction: t });
  } catch (err) {
    if (err.message === 'appointment_overlap') {
      throw Object.assign(new Error('appointment_overlap'), { status: 409 });
    }
    throw err;
  }

  const { token, hash } = generateAccessToken();
  // ponytail: expires 2h before appointment — product can tune this threshold
  const expiresAt = new Date(start.getTime() - 2 * 60 * 60 * 1000);

  await AppointmentAccessToken.create({
    appointment_id: appointment.id,
    token_hash: hash,
    expires_at: expiresAt,
  }, { transaction: t });

  return { appointment, access_token: token };
};

module.exports = { createAppointment, findAvailableProfessional };
