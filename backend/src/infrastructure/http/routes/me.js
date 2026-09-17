import express from 'express';
import { db } from '../../db/client.js';
import * as repos from '../../db/repositories/index.js';
import auth from '../middleware/auth.js';
import { editOwnProfile } from '../../../application/editOwnProfile.js';

const router = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// spec 002 RF-20, RF-21 — cualquier usuario autenticado edita su propio perfil.
router.patch('/', auth, wrap(async (req, res) => {
  const result = await editOwnProfile(db, {
    actor: { id: req.user.id, role: req.user.role },
    body: req.body,
  }, repos);
  res.json(result);
}));

export default router;
