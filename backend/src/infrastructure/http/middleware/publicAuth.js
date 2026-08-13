import { createHash } from 'crypto';
import { db } from '../../db/client.js';
import { tokenRepo } from '../../db/repositories/tokens.js';

export default async (req, res, next) => {
  const { token } = req.query;
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const record = await tokenRepo.findByAppointmentAndHash(db, req.params.id, tokenHash);

  if (!record) return res.status(401).json({ error: 'unauthorized' });
  if (new Date() > record.expires_at) return res.status(401).json({ error: 'token_expired' });

  next();
};
