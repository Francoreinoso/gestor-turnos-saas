import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../../db/client.js';
import { userRepo } from '../../db/repositories/users.js';
import { accounts } from '../../../../db/schema.js';
import { normalizeEmail } from '../../../domain/client.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.post('/register', wrap(async (req, res) => {
  const { business_name, name, email, password } = req.body;
  if (!business_name || !name || !email || !password) throw httpErr(400, 'missing_fields');

  const normalized = normalizeEmail(email);
  const exists = await userRepo.findByEmail(db, normalized);
  if (exists) throw httpErr(409, 'email_taken');

  const { account, user } = await db.transaction(async (tx) => {
    const [account] = await tx.insert(accounts).values({ business_name }).returning();
    const user = await userRepo.create(tx, {
      account_id: account.id,
      name,
      email: normalized,
      password_hash: await bcrypt.hash(password, 10),
      role: 'owner',
    });
    return { account, user };
  });

  const token = jwt.sign(
    { id: user.id, account_id: account.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw httpErr(400, 'missing_fields');

  const user = await userRepo.findByEmail(db, normalizeEmail(email));
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

export default router;
