'use strict';

const router = require('express').Router();
const { Client } = require('../models');
const auth = require('../middleware/auth');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.post('/', auth, wrap(async (req, res) => {
  const { name, email, phone, notes } = req.body;
  if (!name) throw httpErr(400, 'missing_fields');
  if (!email && !phone) throw httpErr(400, 'email_or_phone_required');

  // ponytail: E.164 full normalization needs libphonenumber-js — basic format validation for now
  if (phone && !/^\+\d{7,15}$/.test(phone)) throw httpErr(400, 'invalid_phone_format');

  const client = await Client.create({
    account_id: req.user.account_id,
    name,
    email: email ? email.toLowerCase() : null,
    phone: phone || null,
    notes,
  });

  res.status(201).json(client);
}));

router.get('/', auth, wrap(async (req, res) => {
  res.json(await Client.findAll({ where: { account_id: req.user.account_id } }));
}));

router.get('/:id', auth, wrap(async (req, res) => {
  const client = await Client.findOne({ where: { id: req.params.id, account_id: req.user.account_id } });
  if (!client) throw httpErr(404, 'not_found');
  res.json(client);
}));

router.patch('/:id', auth, wrap(async (req, res) => {
  const client = await Client.findOne({ where: { id: req.params.id, account_id: req.user.account_id } });
  if (!client) throw httpErr(404, 'not_found');

  const { name, email, phone, notes } = req.body;
  if (phone && !/^\+\d{7,15}$/.test(phone)) throw httpErr(400, 'invalid_phone_format');

  await client.update({
    name: name ?? client.name,
    email: email ? email.toLowerCase() : client.email,
    phone: phone ?? client.phone,
    notes: notes ?? client.notes,
  });

  res.json(client);
}));

module.exports = router;
