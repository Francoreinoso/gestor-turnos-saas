// Forma de error uniforme { error: <código> } (extraído de app.js para reutilizarlo en los tests HTTP).
export default (err, req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message || 'internal_error' });
};
