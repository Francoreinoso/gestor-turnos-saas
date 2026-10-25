# Plan 011 — Asistente de IA

## Capas

- `domain/`: esquemas zod de las herramientas (`domain/schemas/assistant.js`), reglas de propuesta (vencimiento, estados).
- `application/assistant/`: `tools/*` (una por herramienta), `runAssistantTurn.js` (bucle), `startSession.js`, `verifySession.js`, `confirmProposal.js`, `cancelOwnAppointment.js`.
- `infrastructure/`: `integrations/llm/` con el puerto `llmClient` (`send({system, messages, tools}) -> {content, stopReason, usage}` en formato normalizado), `anthropicAdapter.js`, `openaiAdapter.js` (fetch nativo) y `index.js` que elige según `ASSISTANT_PROVIDER`, `http/routes/assistant.js`, repos `assistantProposals` y `assistantCodes`, migración `0007`.

## Datos (migración 0007)

- `assistant_proposals(id, account_id, client_id, service_id, employee_id, starts_at, status pendiente|confirmada|descartada|vencida, appointment_id, expires_at)`; índice único parcial por `(client_id, service_id, employee_id, starts_at)` en estado pendiente.
- `assistant_codes(id, account_id, phone, code_hash, attempts, expires_at, used_at)`.
- Migración `0008` (T2b, RF-19): reemplaza los índices únicos globales `clients_phone_unique` y `clients_email_unique` de la 0001 por `(account_id, phone)` y `(account_id, lower(email))`, parciales igual que antes. La 0001 no se edita (principio 8); los datos existentes ya cumplen la regla nueva, que es menos estricta. `clientRepo.findOrCreate` busca por email y luego por teléfono dentro de la cuenta, e inserta con `ON CONFLICT DO NOTHING` y relectura.
- Los `slot_id` viven en la sesión firmada del turno de chat (se reconstruyen del historial de `tool_result`), sin tabla.

## Bucle del agente

Manual, sobre el puerto `llmClient`, sin tocar el formato de ningún proveedor. Las opciones propias de Anthropic (`thinking: {type:"adaptive"}`, `output_config.effort` explícito, tools con `strict: true`, `cache_control` sobre tools+system) viven solo en `anthropicAdapter`. Sin `tool_choice` forzado; historial solo-append. Todos los `tool_result` de un turno van en un único mensaje de usuario. La fecha actual se inyecta al final del system prompt.

## Proveedores

- Formato normalizado: bloques `text`, `tool_use {id,name,input}` y `tool_result {tool_use_id,content,is_error}`; `stopReason` en `end_turn | tool_use | max_tokens | refusal`.
- `openaiAdapter` traduce `tool_use` a `tool_calls`, los `tool_result` a mensajes `role: tool`, y `finish_reason` (`stop`, `tool_calls`, `length`, `content_filter`) a `stopReason`. Si el modelo devuelve los argumentos como JSON inválido, se trata como entrada inválida (`is_error`), no como fallo del servidor.
- Configuración: `ASSISTANT_PROVIDER`, `ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY`; con `openai` el `ASSISTANT_MODEL` no tiene valor por defecto y es obligatorio.

## Riesgos

- Identidad por teléfono: mitigado con código de un solo uso y límites.
- Inyección de prompt vía datos del negocio: el backend impone los permisos; el prompt es solo una segunda barrera.
- Costo: tope de iteraciones, caché de prompt, límite de mensajes por sesión.
- Modelos gratuitos pequeños: más errores de herramientas y respuestas fuera de tema; mitigado por validación zod, tope de iteraciones y confirmación por botón. Los límites de las capas gratuitas cambian: se verifican al momento de la demo, y un 429 se traduce a 503 `assistant_busy` (RF-18).
