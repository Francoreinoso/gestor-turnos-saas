import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideInviteAction } from '../../src/domain/staffInvite.js';

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

test('sin usuario existente → create', () => {
  assert.equal(decideInviteAction({ existingUser: null, accountId: ACCOUNT_A }), 'create');
});

test('activo en cualquier cuenta → reject', () => {
  assert.equal(
    decideInviteAction({ existingUser: { status: 'activo', account_id: ACCOUNT_A }, accountId: ACCOUNT_A }),
    'reject',
  );
  assert.equal(
    decideInviteAction({ existingUser: { status: 'activo', account_id: ACCOUNT_B }, accountId: ACCOUNT_A }),
    'reject',
  );
});

test('pendiente o inactivo de OTRA cuenta → reject', () => {
  assert.equal(
    decideInviteAction({ existingUser: { status: 'pendiente', account_id: ACCOUNT_B }, accountId: ACCOUNT_A }),
    'reject',
  );
  assert.equal(
    decideInviteAction({ existingUser: { status: 'inactivo', account_id: ACCOUNT_B }, accountId: ACCOUNT_A }),
    'reject',
  );
});

test('inactivo de la MISMA cuenta → reactivate', () => {
  assert.equal(
    decideInviteAction({ existingUser: { status: 'inactivo', account_id: ACCOUNT_A }, accountId: ACCOUNT_A }),
    'reactivate',
  );
});

test('pendiente de la MISMA cuenta → resend', () => {
  assert.equal(
    decideInviteAction({ existingUser: { status: 'pendiente', account_id: ACCOUNT_A }, accountId: ACCOUNT_A }),
    'resend',
  );
});
