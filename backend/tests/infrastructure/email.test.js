import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailService } from '../../src/infrastructure/integrations/email.js';

test('sendInvitation loguea destinatario y enlace, no lanza', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await emailService.sendInvitation({ to: 'ana@test.com', link: 'https://app/activate/abc' });
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some(l => l.includes('ana@test.com') && l.includes('https://app/activate/abc')));
});
