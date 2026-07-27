'use strict';

const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Account, User } = require('../models');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.post('/register', wrap(async (req, res) => {
  const { business_name, name, email, password } = req.body;
  if (!business_name || !name || !email || !password) throw httpErr(400, 'missing_fields');

  const exists = await User.findOne({ where: { email: email.toLowerCase() } });
  if (exists) throw httpErr(409, 'email_taken');

  const result = await Account.sequelize.transaction(async (t) => {
    const account = await Account.create({ business_name }, { transaction: t });
    const user = await User.create({
      account_id: account.id,
      name,
      email: email.toLowerCase(),
      password_hash: await bcrypt.hash(password, 10),
      role: 'owner',
    }, { transaction: t });
    return { account, user };
  });

  const token = jwt.sign(
    { id: result.user.id, account_id: result.account.id, role: result.user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpErr(400, 'missing_fields');

  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) throw httpErr(401, 'invalid_credentials');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw httpErr(401, 'invalid_credentials');

  const token = jwt.sign(
    { id: user.id, account_id: user.account_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token });
}));

module.exports = router;
