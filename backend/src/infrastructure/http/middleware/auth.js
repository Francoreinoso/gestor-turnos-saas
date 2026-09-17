import jwt from 'jsonwebtoken';
import { db } from '../../db/client.js';
import { userRepo } from '../../db/repositories/users.js';

// spec 002 RF-30: además del JWT, valida en cada request que el usuario siga 'activo' —
// una baja revoca el acceso de inmediato, sin esperar a que el token expire.
export default async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await userRepo.findById(db, payload.id);
    if (!user || user.status !== 'activo') return res.status(401).json({ error: 'unauthorized' });

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
};
