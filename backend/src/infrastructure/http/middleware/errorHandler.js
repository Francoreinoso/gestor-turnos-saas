// spec 008 RF-1..RF-3 — único lugar que distingue un error de aplicación de uno inesperado.
// Forma de error uniforme { error: <código> }; nada interno (SQL, mensajes, trazas) llega al cliente.

// Los errores de aplicación llevan un código como mensaje (`httpErr(404, 'not_found')`).
const CODE_RE = /^[a-z][a-z0-9_]*$/;

// Errores de body-parser: se traducen a un código fijo, nunca se devuelve su mensaje (D1).
const PARSER_ERRORS = {
  'entity.parse.failed': { status: 400, error: 'invalid_body' },
  'entity.too.large': { status: 413, error: 'payload_too_large' },
  'encoding.unsupported': { status: 415, error: 'unsupported_media_type' },
  'charset.unsupported': { status: 415, error: 'unsupported_media_type' },
};

export const toResponse = (err) => {
  const parser = PARSER_ERRORS[err?.type];
  if (parser) return { status: parser.status, body: { error: parser.error } };

  const status = err?.status;
  if (Number.isInteger(status) && status >= 400 && status <= 499) {
    return { status, body: { error: CODE_RE.test(err.message ?? '') ? err.message : 'bad_request' } };
  }
  return { status: 500, body: { error: 'internal_error' } };
};

export const createErrorHandler = ({ log }) => (err, req, res, _next) => {
  const response = toResponse(err);
  // RF-2: solo los inesperados se registran. Ruta sin query string (puede llevar el token de un enlace de gestión);
  // nunca cuerpo ni cabeceras.
  if (response.status === 500) log(`[error] ${req.method} ${req.path}`, err);
  res.status(response.status).json(response.body);
};

export default createErrorHandler({ log: (...args) => console.error(...args) });
