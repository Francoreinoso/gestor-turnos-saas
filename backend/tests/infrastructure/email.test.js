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

// spec 009 RF-22 — el log lleva el enlace de activación completo, no el token suelto.
test('sendInvitation imprime el enlace de activación completo', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await emailService.sendInvitation({ to: 'ana@test.com', link: 'http://localhost:5173/activar?token=abc123' });
  } finally {
    console.log = originalLog;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[email\] invitación de trabajador → ana@test\.com: http:\/\/localhost:5173\/activar\?token=abc123$/);
});
