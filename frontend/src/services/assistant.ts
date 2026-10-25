import { apiPublic } from './api';
import type { AssistantReply, ConfirmedProposal } from '../domain/assistant';

// spec 011 — cliente de /assistant/*. El token de sesión se recibe por argumento: este módulo no lo guarda.
export const assistantService = {
  startSession: (accountId: string, phone: string) =>
    apiPublic.post<{ message: string }>('/assistant/session', { account_id: accountId, phone }),

  verify: (accountId: string, phone: string, code: string) =>
    apiPublic.post<{ token: string; expires_in: number }>('/assistant/session/verify', { account_id: accountId, phone, code }),

  sendMessage: (token: string, message: string, conversation: string | null) =>
    apiPublic.post<AssistantReply>('/assistant/messages', { message, ...(conversation ? { conversation } : {}) }, token),

  // RF-11: la reserva se confirma con el botón, sin pasar por el modelo.
  confirm: (token: string, proposalId: string) =>
    apiPublic.post<ConfirmedProposal>(`/assistant/proposals/${proposalId}/confirm`, undefined, token),
};
