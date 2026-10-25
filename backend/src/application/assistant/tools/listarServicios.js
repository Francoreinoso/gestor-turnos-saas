import { listarServiciosInput } from '../../../domain/schemas/assistant.js';

// spec 011 RF-5 — servicios activos de la cuenta de la sesión, con duración y precio.
export const listarServicios = {
  name: 'listar_servicios',
  description: 'Lista los servicios activos del negocio con su duración en minutos y su precio. Úsala antes de consultar disponibilidad para obtener el servicio_id.',
  input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  schema: listarServiciosInput,

  run: async ({ db, repos, accountId }) => {
    const services = await repos.services.findAll(db, accountId, { active: true });
    return {
      servicios: services
        .map((s) => ({ servicio_id: s.id, nombre: s.name, duracion_minutos: s.duration_minutes, precio: s.price }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  },
};
