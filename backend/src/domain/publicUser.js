// spec 009 RF-1 — vista de un usuario que sale por HTTP: lista blanca, nunca el registro completo de la DB.
export const toPublicUser = (user) => user && ({
  id: user.id,
  account_id: user.account_id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  commission_rate: user.commission_rate,
  created_at: user.created_at,
  updated_at: user.updated_at,
});
