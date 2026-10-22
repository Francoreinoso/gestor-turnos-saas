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
  not_found: 'No encontramos lo que buscas.',
  missing_fields: 'Faltan datos para completar la solicitud.',
  client_required: 'Faltan tus datos de contacto.',
  service_not_found: 'Ese servicio ya no está disponible.',
  invalid_scheduled_at: 'La fecha y hora elegidas no son válidas.',
  network_error: 'No pudimos conectarnos. Revisa tu conexión y reintenta.',
};

export function publicErrorMessage(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC;
}

// spec 009 RF-8 — errores de las pantallas de gestión. Hablan con el dueño del negocio, no con el cliente final,
// por eso van aparte de `publicErrorMessage`.
const MANAGEMENT_MESSAGES: Record<string, string> = {
  email_taken: 'Ese email ya está en uso.',
  invalid_commission: 'La comisión debe ser un número entre 0 y 100.',
  invalid_commission_rate: 'La comisión debe ser un número entre 0 y 100.',
  invalid_field: 'Alguno de los datos no es válido. Revísalos e intenta de nuevo.',
  invalid_body: 'Alguno de los datos no es válido. Revísalos e intenta de nuevo.',
  missing_fields: 'Completa todos los campos obligatorios.',
  invalid_window: 'Alguno de los tramos del horario no es válido.',
  invalid_time_format: 'Las horas deben tener el formato HH:mm, por ejemplo 09:30.',
  invalid_day_of_week: 'Alguno de los días del horario no es válido.',
  start_must_be_before_end: 'En cada tramo, la hora de inicio debe ser anterior a la de fin.',
  overlapping_windows: 'Hay tramos que se solapan dentro del mismo día. Ajusta las horas.',
  invalid_availability: 'No pudimos guardar ese horario. Revisa que los tramos no se solapen.',
  invalid_status_transition: 'Esa acción ya no es posible con el estado actual de este trabajador.',
  user_inactive: 'Este trabajador está inactivo y no se le puede cambiar el horario.',
  invalid_password: 'La contraseña debe tener entre 8 y 72 caracteres.',
  forbidden: 'No tienes permiso para hacer esto.',
  unauthorized: 'Tu sesión venció. Vuelve a iniciar sesión.',
  not_found: 'No encontramos lo que buscas.',
  network_error: 'No pudimos conectarnos. Revisa tu conexión y reintenta.',
  too_many_requests: 'Hiciste demasiados intentos. Espera unos minutos y vuelve a probar.',
};

export function managementErrorMessage(code: string | undefined): string {
  return (code && MANAGEMENT_MESSAGES[code]) || GENERIC;
}
