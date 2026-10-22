const GENERIC = 'Ocurrió un error inesperado. Intentá de nuevo en unos minutos.';

// RF-33: único lugar que traduce los códigos de la API pública a mensajes en español.
const MESSAGES: Record<string, string> = {
  appointment_overlap: 'Ese horario ya no está disponible. Elegí otro.',
  no_professional_available: 'Ese horario ya no está disponible con ningún profesional. Elegí otro.',
  appointment_in_past: 'Ese horario ya pasó. Elegí uno futuro.',
  token_expired: 'El plazo para modificar este turno venció. Comunicate con el negocio.',
  unauthorized: 'Enlace inválido.',
  too_many_requests: 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.',
  invalid_status_transition: 'Este turno ya no se puede modificar.',
  not_found: 'No encontramos lo que buscás.',
  missing_fields: 'Faltan datos para completar la solicitud.',
  client_required: 'Faltan tus datos de contacto.',
  service_not_found: 'Ese servicio ya no está disponible.',
  invalid_scheduled_at: 'La fecha y hora elegidas no son válidas.',
  network_error: 'No pudimos conectarnos. Revisá tu conexión y reintentá.',
};

export function publicErrorMessage(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC;
}
