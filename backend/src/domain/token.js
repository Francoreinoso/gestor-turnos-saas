import { randomBytes, createHash } from 'crypto';

export const generateAccessToken = () => {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
};
