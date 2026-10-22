import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvitationLink } from '../../src/domain/invitation.js';

// spec 009 RF-21, RF-22
test('arma ${appUrl}/activar?token=…', () => {
  assert.equal(buildInvitationLink('http://localhost:5173', 'abc'), 'http://localhost:5173/activar?token=abc');
});

test('ignora la barra final de appUrl (una o varias)', () => {
  assert.equal(buildInvitationLink('https://app.test/', 'abc'), 'https://app.test/activar?token=abc');
  assert.equal(buildInvitationLink('https://app.test///', 'abc'), 'https://app.test/activar?token=abc');
});

test('codifica el token (encodeURIComponent)', () => {
  assert.equal(buildInvitationLink('https://app.test', 'a b&c=d/e?f'), 'https://app.test/activar?token=a%20b%26c%3Dd%2Fe%3Ff');
});

test('conserva una ruta base en appUrl', () => {
  assert.equal(buildInvitationLink('https://app.test/panel/', 'abc'), 'https://app.test/panel/activar?token=abc');
});
