// spec 002 RF-6/RF-7/RF-8: qué rama toma el alta de un trabajador según si el
// email ya pertenece a un usuario existente, su estado y su cuenta.
export const decideInviteAction = ({ existingUser, accountId }) => {
  if (!existingUser) return 'create';
  if (existingUser.status === 'activo') return 'reject'; // RF-6
  if (existingUser.account_id !== accountId) return 'reject'; // RF-6: pendiente/inactivo de otra cuenta, el email sigue reservado
  return existingUser.status === 'inactivo' ? 'reactivate' : 'resend'; // RF-7 / RF-8
};
