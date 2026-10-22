import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupDb, teardownDb, withAccount, db } from '../helpers/db.js';
import { startPublicServer } from '../helpers/publicServer.js';

// Archivo propio: los limitadores guardan su contador en memoria por proceso, y los demás
// tests públicos también consumen cupo (node --test corre cada archivo en su proceso).
let api;
before(async () => { await setupDb(); api = await startPublicServer(); });
after(async () => { await api.close(); await teardownDb(); });

test('lecturas: 25 seguidas → todas 200 (tope propio de 120) — RF-8', () =>
  withAccount(async (account) => {
    for (let i = 0; i < 25; i++) {
      const res = await api.get(`/public/accounts/${account.id}`);
      assert.equal(res.status, 200, `lectura #${i + 1}`);
    }
  }));

test('escrituras: la 21ª con token inválido → 429 too_many_requests; las lecturas siguen con su propio cupo — RF-8', () =>
  withAccount(async (account) => {
    const id = crypto.randomUUID();
    for (let i = 1; i <= 20; i++) {
      const res = await api.patch(`/public/appointments/${id}/cancel?token=malo`);
      assert.equal(res.status, 401, `escritura #${i}`);
    }
    const blocked = await api.patch(`/public/appointments/${id}/cancel?token=malo`);
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { error: 'too_many_requests' });

    // El cupo estricto también cubre reservar, reprogramar y activar...
    assert.equal((await api.post('/public/bookings', {})).status, 429);
    assert.equal((await api.patch(`/public/appointments/${id}/reschedule?token=malo`, {})).status, 429);
    assert.equal((await api.post('/public/staff-invitations/activate', {})).status, 429);
    // ...pero no las lecturas.
    assert.equal((await api.get(`/public/accounts/${account.id}`)).status, 200);
  }));
