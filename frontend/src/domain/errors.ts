const GENERIC = 'Ocurrió un error inesperado. Intenta de nuevo en unos minutos.';

// RF-33: único lugar que traduce los códigos de la API pública a mensajes en español.
const MESSAGES: Record<string, string> = {
  appointment_overlap: 'Ese horario ya no está disponible. Elige otro.',
  no_professional_available: 'Ese horario ya no está disponible con ningún profesional. Elige otro.',
  appointment_in_past: 'Ese horario ya pasó. Elige uno futuro.',
  token_expired: 'El plazo para modificar este turno venció. Comunícate con el negocio.',
  unauthorized: 'Enlace inválido.',
  too_many_requests: 'Hiciste demasiados intentos. Espera unos minutos y vuelve a probar.',
  invalid_status_transition: 'Este turno ya no se puede modificar.',
  not_found: 'No encontramos lo que buscás.',
  missing_fields: 'Faltan datos para completar la solicitud.',
  client_required: 'Faltan tus datos de contacto.',
  service_not_found: 'Ese servicio ya no está disponible.',
  invalid_scheduled_at: 'La fecha y hora elegidas no son válidas.',
  network_error: 'No pudimos conectarnos. Revisa tu conexión y reintenta.',
};

export function publicErrorMessage(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC;
}
