// spec 008 RF-16, D6 — cabeceras de seguridad de una API que solo devuelve JSON. Se aplica antes que cualquier otra
// capa, para que también las lleven los errores del parser, los 401 y los 429.
//  - nosniff: el navegador no reinterpreta el tipo de contenido.
//  - Referrer-Policy: no-referrer: ni siquiera una URL con `?token=` de un enlace de gestión viaja como Referer.
//  - Cache-Control: no-store: ni datos autenticados ni respuestas con tokens se guardan en cachés intermedias.
export default (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
};
