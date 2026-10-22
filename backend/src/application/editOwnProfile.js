import bcrypt from 'bcrypt';
import { parseInput } from '../domain/validation.js';
import { editSelfBody } from '../domain/schemas/staff.js';
import { toPublicUser } from '../domain/publicUser.js';

// spec 002 — cualquier usuario autenticado edita su propio nombre y contraseña: RF-20, RF-21.
export const editOwnProfile = async (db, { actor, body }, repos) => {
  const changes = parseInput(editSelfBody, body); // RF-21

  if ('password' in changes) {
    changes.password_hash = await bcrypt.hash(changes.password, 10);
    delete changes.password;
  }

  return { user: toPublicUser(await repos.users.update(db, actor.id, changes)) }; // RF-20
};
