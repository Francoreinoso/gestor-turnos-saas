'use strict';

const crypto = require('crypto');

const generateAccessToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
};

module.exports = { generateAccessToken };
