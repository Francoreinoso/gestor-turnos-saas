# Tasks 011

- [x] T1 Dependencia `@anthropic-ai/sdk`, variables en `loadConfig` y `.env.example` (test de config)
- [x] T2 Migración 0007 + repos de propuestas y códigos (integración con Postgres)
- [x] T2b Unicidad de teléfono y email de `clients` por cuenta (migración 0008) y `findOrCreate` por email o teléfono, a prueba de altas simultáneas (RF-19)
- [x] T3 Filtro `clientId` en listado de turnos + `cancelOwnAppointment` (RF-7, RF-9)
- [x] T4 Esquemas zod y herramientas `listar_servicios`, `ver_disponibilidad`, `ver_mis_turnos` (RF-5..7)
- [x] T5 `proponer_reserva` y `confirmProposal` idempotente (RF-8, RF-11..13)
- [x] T6 `cancelar_turno` (RF-9)
- [x] T6b Puerto `llmClient` y formato normalizado (mensajes, `tool_use`, `tool_result`, `stopReason`) con un LLM falso para pruebas
- [x] T6c `anthropicAdapter` (opciones propias de Anthropic, importación dinámica del SDK; tests con respuestas simuladas)
- [x] T6d `openaiAdapter` con `fetch` nativo: `tool_calls`↔`tool_use`, `finish_reason`↔`stopReason`, JSON de argumentos inválido como `is_error`, 429/red/timeout/5xx a error tipificado (RF-18; tests con respuestas simuladas)
- [x] T6e Configuración: `ASSISTANT_PROVIDER`, `ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY` en `loadConfig` (el modelo es obligatorio con `openai`; sin clave del proveedor elegido, 503 `assistant_unavailable`, RNF-2), y en `backend/.env.example`, `.env.example` de la raíz, `docker-compose.yml` y README (completa lo que T1 dejó solo para Anthropic)
- [x] T7 `runAssistantTurn` sobre el puerto, con LLM falso: tool_use paralelo, `is_error`, tope de iteraciones, `stopReason` refusal/max_tokens (RF-10, RF-16)
- [x] T8 Sesión por teléfono: código, verificación, límites (RF-1..4)
- [x] T9 Rutas `/assistant/*` + tests de integración, de aislamiento por cuenta y del 503 `assistant_busy` (RF-18)
- [x] T10 Widget de chat en la página pública (Vitest)
- [x] T11 Evals con el modelo configurado (RF-17), contra al menos un proveedor — avisar antes de correr de los límites de uso del proveedor (y del costo si es de pago) y comparar los resultados por proveedor. _Corrido contra Groq `openai/gpt-oss-120b`: 27/27 en 3 repeticiones, tras indicar en el prompt que elija profesional si el cliente no tiene preferencia (la primera corrida dio 26/27) (resultado en `backend/evals/results/`). Groq queda como proveedor de la demo. No se comparó con Gemini `gemini-3.8-flash`: su capa gratuita admite 20 pedidos por día y una corrida de 3 repeticiones necesita más de 80._
- [x] T12 README y docs actualizados
