import { createHash } from 'crypto';
import { db } from '../../db/client.js';
import { isUuid } from '../../../domain/uuid.js';
import { tokenRepo } from '../../db/repositories/tokens.js';

export default async (req, res, next) => {
  const { token } = req.query;
  // spec 005 RF-7: id mal formado o token que no es string → 401 antes de tocar la base (no confirma existencia, no da 500).
  if (typeof token !== 'string' || !token || !isUuid(req.params.id)) return res.status(401).json({ error: 'unauthorized' });

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await tokenRepo.findByAppointmentAndHash(db, req.params.id, tokenHash);

  if (!record) return res.status(401).json({ error: 'unauthorized' });
  if (new Date() > record.expires_at) return res.status(401).json({ error: 'token_expired' });

  next();
};
