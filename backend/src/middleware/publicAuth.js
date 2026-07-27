'use strict';

const crypto = require('crypto');
const { AppointmentAccessToken } = require('../models');

module.exports = async (req, res, next) => {
  const { token } = req.query;
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const record = await AppointmentAccessToken.findOne({
    where: { appointment_id: req.params.id, token_hash: tokenHash },
  });

  if (!record) return res.status(401).json({ error: 'unauthorized' });
  if (new Date() > record.expires_at) return res.status(401).json({ error: 'token_expired' });

  next();
};
