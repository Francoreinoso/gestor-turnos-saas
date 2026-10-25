// spec 011 — asistente de IA de la página pública: tipos de la API /assistant/* y mensajes de error para el cliente.
import { PHONE_REGEX } from './booking';

export interface AssistantProposal {
  id: string;
  service: string;
  professional: string | null;
  starts_at: string;
  expires_at: string;
}

export interface AssistantReply {
  reply: string;
  proposals: AssistantProposal[];
  // Historial firmado por el servidor; se devuelve tal cual en el mensaje siguiente.
  conversation: string;
}

export interface ConfirmedProposal {
  proposal_id: string;
  appointment: { id: string; scheduled_at: string; scheduled_until: string; status: string };
  // Solo en la primera confirmación (enlace de gestión, spec 005).
  access_token?: string;
}

export const isValidPhone = (phone: string) => PHONE_REGEX.test(phone.trim());
export const isValidCode = (code: string) => /^\d{6}$/.test(code.trim());

const GENERIC = 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos.';

const MESSAGES: Record<string, string> = {
  assistant_busy: 'El asistente está ocupado. Intenta de nuevo en unos minutos.',
  assistant_unavailable: 'El asistente no está disponible por ahora. Puedes reservar con el formulario de arriba.',
  invalid_code: 'El código no es correcto o ya venció. Revísalo o pide uno nuevo.',
  invalid_phone_format: 'Ingresa el teléfono en formato internacional, por ejemplo +56912345678.',
  too_many_requests: 'Hiciste demasiados intentos. Espera unos minutos y vuelve a probar.',
  conversation_limit: 'Esta conversación llegó a su límite. Empieza una nueva para seguir.',
  invalid_conversation: 'La conversación ya no es válida. Empieza una nueva para seguir.',
  unauthorized: 'Tu sesión con el asistente venció. Ingresa tu teléfono otra vez.',
  appointment_overlap: 'Ese horario ya fue tomado.',
  proposal_expired: 'La propuesta venció (dura 10 minutos). Pídele al asistente que la prepare de nuevo.',
  proposal_discarded: 'Esa propuesta ya no está disponible. Pídele al asistente otra opción.',
  appointment_in_past: 'Ese horario ya pasó. Pídele al asistente otra opción.',
  not_found: 'No encontramos esa propuesta.',
  message_too_long: 'El mensaje es demasiado largo. Escríbelo en menos palabras.',
  network_error: 'No pudimos conectarnos. Revisa tu conexión y reintenta.',
};

export function assistantErrorMessage(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC;
}

// Mensaje que el widget envía por el cliente cuando el horario se ocupó al confirmar (RF-13).
export const OTHER_OPTIONS_MESSAGE = 'El horario que elegí ya fue tomado. ¿Qué otras opciones tengo?';
