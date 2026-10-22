import express from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// spec 006 RF-15 / D-P5: 200 si la base responde, 503 si no. Sin autenticación ni detalles del error.
// `ping` es inyectable para probar el 503 sin tumbar Postgres.
export const createHealthRouter = ({ ping = () => db.execute(sql`select 1`), timeoutMs = 2000 } = {}) => {
  const router = express.Router();

  router.get('/', wrap(async (req, res) => {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); });
    try {
      await Promise.race([ping(), timeout]);
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  }));

  return router;
};

export default createHealthRouter();
