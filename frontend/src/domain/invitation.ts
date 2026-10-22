// spec 009 RF-11, RF-23, RF-24 — enlace de activación del trabajador invitado.
export const INVITATION_NOTICE = 'Aún no enviamos emails: entrégale este enlace al trabajador. Vence en 72 horas.';

// '?token=abc' → 'abc'; sin token (o vacío) → null.
export function readActivationToken(search: string): string | null {
  const token = new URLSearchParams(search).get('token');
  return token ? token : null;
}
