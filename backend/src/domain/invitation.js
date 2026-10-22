// spec 009 RF-21, RF-22 — enlace de activación que se entrega al trabajador invitado.
export const buildInvitationLink = (appUrl, token) =>
  `${appUrl.replace(/\/+$/, '')}/activar?token=${encodeURIComponent(token)}`;
