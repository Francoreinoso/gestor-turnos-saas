import bcrypt from 'bcrypt';
import { assertSelfEditablePayload } from '../domain/staffEdit.js';

// spec 002 — cualquier usuario autenticado edita su propio nombre y contraseña: RF-20, RF-21.
export const editOwnProfile = async (db, { actor, body }, repos) => {
  const changes = assertSelfEditablePayload(body); // RF-21

  if ('password' in changes) {
    changes.password_hash = await bcrypt.hash(changes.password, 10);
    delete changes.password;
  }

  return { user: await repos.users.update(db, actor.id, changes) }; // RF-20
};
