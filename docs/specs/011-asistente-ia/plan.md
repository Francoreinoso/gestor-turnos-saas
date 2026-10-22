# Plan 011 — Asistente de IA

## Capas

- `domain/`: esquemas zod de las herramientas (`domain/schemas/assistant.js`), reglas de propuesta (vencimiento, estados).
- `application/assistant/`: `tools/*` (una por herramienta), `runAssistantTurn.js` (bucle), `startSession.js`, `verifySession.js`, `confirmProposal.js`, `cancelOwnAppointment.js`.
- `infrastructure/`: `integrations/llm.js` (cliente Anthropic inyectable), `http/routes/assistant.js`, repos `assistantProposals` y `assistantCodes`, migración `0007`.

## Datos (migración 0007)

- `assistant_proposals(id, account_id, client_id, service_id, employee_id, starts_at, status pendiente|confirmada|descartada|vencida, appointment_id, expires_at)`; índice único parcial por `(client_id, service_id, employee_id, starts_at)` en estado pendiente.
- `assistant_codes(id, account_id, phone, code_hash, attempts, expires_at, used_at)`.
- Los `slot_id` viven en la sesión firmada del turno de chat (se reconstruyen del historial de `tool_result`), sin tabla.

## Bucle del agente

Manual, sobre `client.messages.create`: `thinking: {type:"adaptive"}`, `output_config.effort` explícito, tools con `strict: true` y sin `tool_choice` forzado, `cache_control` sobre tools+system, historial solo-append. Todos los `tool_result` de un turno van en un único mensaje de usuario. La fecha actual se inyecta al final del system prompt.

## Riesgos

- Identidad por teléfono: mitigado con código de un solo uso y límites.
- Inyección de prompt vía datos del negocio: el backend impone los permisos; el prompt es solo una segunda barrera.
- Costo: tope de iteraciones, caché de prompt, límite de mensajes por sesión.
