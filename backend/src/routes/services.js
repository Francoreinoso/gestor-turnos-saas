'use strict';

const router = require('express').Router();
const { Service, ServicePriceHistory } = require('../models');
const auth = require('../middleware/auth');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const ownerOnly = (req, res, next) => req.user.role === 'owner' ? next() : res.status(403).json({ error: 'forbidden' });

router.post('/', auth, ownerOnly, wrap(async (req, res) => {
  const { name, duration_minutes, price } = req.body;
  if (!name || !duration_minutes || price === undefined) throw httpErr(400, 'missing_fields');

  const service = await Service.sequelize.transaction(async (t) => {
    const s = await Service.create({
      account_id: req.user.account_id,
      name,
      duration_minutes,
      price,
    }, { transaction: t });

    // Record birth price in history
    await ServicePriceHistory.create({ service_id: s.id, price }, { transaction: t });
    return s;
  });

  res.status(201).json(service);
}));

router.get('/', auth, wrap(async (req, res) => {
  const where = { account_id: req.user.account_id };
  if (req.query.active !== undefined) where.active = req.query.active === 'true';

  res.json(await Service.findAll({ where }));
}));

router.get('/:id', auth, wrap(async (req, res) => {
  const service = await Service.findOne({ where: { id: req.params.id, account_id: req.user.account_id } });
  if (!service) throw httpErr(404, 'not_found');
  res.json(service);
}));

router.patch('/:id', auth, ownerOnly, wrap(async (req, res) => {
  const service = await Service.findOne({ where: { id: req.params.id, account_id: req.user.account_id } });
  if (!service) throw httpErr(404, 'not_found');

  const { name, duration_minutes } = req.body;
  await service.update({ name, duration_minutes });
  res.json(service);
}));

router.patch('/:id/prices', auth, ownerOnly, wrap(async (req, res) => {
  const { price } = req.body;
  if (price === undefined) throw httpErr(400, 'missing_fields');

  const service = await Service.findOne({ where: { id: req.params.id, account_id: req.user.account_id } });
  if (!service) throw httpErr(404, 'not_found');

  await Service.sequelize.transaction(async (t) => {
    await service.update({ price }, { transaction: t });
    await ServicePriceHistory.create({ service_id: service.id, price }, { transaction: t });
  });

  res.json(service);
}));

router.patch('/:id/deactivate', auth, ownerOnly, wrap(async (req, res) => {
  const service = await Service.findOne({ where: { id: req.params.id, account_id: req.user.account_id } });
  if (!service) throw httpErr(404, 'not_found');
  await service.update({ active: false });
  res.json(service);
}));

module.exports = router;
