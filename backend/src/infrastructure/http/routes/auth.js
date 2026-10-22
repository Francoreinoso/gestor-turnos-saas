import express from 'express';
import bcrypt from 'bcrypt';
import { signToken } from '../jwt.js';
import { loginLimiter, registerLimiter } from '../middleware/limiters.js';
import { db } from '../../db/client.js';
import { userRepo } from '../../db/repositories/users.js';
import * as repos from '../../db/repositories/index.js';
import { login } from '../../../application/login.js';
import { accounts } from '../../../../db/schema.js';
import { parseInput } from '../../../domain/validation.js';
import { registerBody, loginBody } from '../../../domain/schemas/auth.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.post('/register', registerLimiter, wrap(async (req, res) => {
  const { business_name, name, email: normalized, password } = parseInput(registerBody, req.body);
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

  const token = signToken({ id: user.id, account_id: account.id, role: user.role });

  res.status(201).json({ token });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = parseInput(loginBody, req.body);

  const user = await login(db, { email, password }, repos); // spec 008 RF-12: comparación bcrypt constante

  const token = signToken({ id: user.id, account_id: user.account_id, role: user.role });

  res.json({ token });
}));

export default router;
