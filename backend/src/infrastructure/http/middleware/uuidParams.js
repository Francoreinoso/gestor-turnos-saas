import { isUuid } from '../../../domain/uuid.js';

// spec 008 RF-5, D-P2: un parámetro de ruta que no es UUID responde como si el recurso no existiera, sin consultar la base.
// `router.param` corre al resolver el parámetro, antes de `auth` y del handler, y no se puede olvidar ruta por ruta.
// `codes` mapea nombre de parámetro → código del 404 (el mismo que ya devuelve la ruta para un id válido inexistente).
export const uuidParams = (router, codes = { id: 'not_found' }) => {
  for (const [name, code] of Object.entries(codes)) {
    router.param(name, (req, res, next, value) => {
      if (!isUuid(value)) return res.status(404).json({ error: code });
      next();
    });
  }
};
