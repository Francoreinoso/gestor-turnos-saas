import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../../db/client.js';
import { userRepo } from '../../db/repositories/users.js';
import { accounts } from '../../../../db/schema.js';
import { parseInput } from '../../../domain/validation.js';
import { registerBody, loginBody } from '../../../domain/schemas/auth.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });

router.post('/register', wrap(async (req, res) => {
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

  const token = jwt.sign(
    { id: user.id, account_id: account.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({ token });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = parseInput(loginBody, req.body);

  const user = await userRepo.findByEmail(db, email);
  if (!user || user.status !== 'activo') throw httpErr(401, 'invalid_credentials'); // spec 002: no filtra pendiente/inactivo

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
