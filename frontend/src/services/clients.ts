import { api } from './api';
import type { Client } from '../domain/types';

// spec 010 RF-8 — el selector de cliente busca en el navegador sobre el listado completo de la cuenta (R4).
export const clientsService = {
  list: () => api.get<Client[]>('/clients'),
};
