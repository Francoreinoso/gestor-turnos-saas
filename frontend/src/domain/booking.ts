// Misma regla que el backend (domain/client.js PHONE_REGEX).
export const PHONE_REGEX = /^\+\d{7,15}$/;

export interface ClientInput {
  name: string;
  email: string;
  phone: string;
}

export type ClientErrors = Partial<Record<'name' | 'email' | 'phone' | 'contact', string>>;

// RF-18: nombre y al menos email o teléfono, con formato válido, antes de enviar.
export function validateClient({ name, email, phone }: ClientInput): ClientErrors {
  const errors: ClientErrors = {};
  const e = email.trim();
  const p = phone.trim();

  if (!name.trim()) errors.name = 'Ingresa tu nombre.';
  if (!e && !p) errors.contact = 'Ingresa un email o un teléfono para contactarte.';
  if (e && !e.includes('@')) errors.email = 'Ingresa un email válido.';
  if (p && !PHONE_REGEX.test(p)) errors.phone = 'Ingresa el teléfono en formato internacional, por ejemplo +56912345678.';
  return errors;
}

export interface BookingPayload {
  account_id: string;
  service_id: string;
  scheduled_at: string;
  client: { name: string; email?: string; phone?: string };
  employee_id?: string;
  notes?: string;
}

// RF-16: "Cualquiera" (employeeId null) envía la solicitud sin employee_id.
export function buildBookingPayload(input: {
  accountId: string;
  serviceId: string;
  scheduledAt: string;
  employeeId: string | null;
  client: ClientInput;
  notes: string;
}): BookingPayload {
  const email = input.client.email.trim();
  const phone = input.client.phone.trim();
  const notes = input.notes.trim();

  return {
    account_id: input.accountId,
    service_id: input.serviceId,
    scheduled_at: input.scheduledAt,
    client: { name: input.client.name.trim(), ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
    ...(input.employeeId ? { employee_id: input.employeeId } : {}),
    ...(notes ? { notes } : {}),
  };
}

// RF-20 / RF-28: enlace completo de gestión del turno.
export function manageLink(origin: string, appointmentId: string, token: string): string {
  return `${origin}/turno/${appointmentId}?token=${encodeURIComponent(token)}`;
}
