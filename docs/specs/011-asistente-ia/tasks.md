# Tasks 011

- [x] T1 Dependencia `@anthropic-ai/sdk`, variables en `loadConfig` y `.env.example` (test de config)
- [ ] T2 Migración 0007 + repos de propuestas y códigos (integración con Postgres)
- [ ] T3 Filtro `clientId` en listado de turnos + `cancelOwnAppointment` (RF-7, RF-9)
- [ ] T4 Esquemas zod y herramientas `listar_servicios`, `ver_disponibilidad`, `ver_mis_turnos` (RF-5..7)
- [ ] T5 `proponer_reserva` y `confirmProposal` idempotente (RF-8, RF-11..13)
- [ ] T6 `cancelar_turno` (RF-9)
- [ ] T6b Puerto `llmClient` normalizado + `anthropicAdapter` + `openaiAdapter` (tests con respuestas simuladas; `ASSISTANT_PROVIDER`, `ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY` en `loadConfig`, `.env.example` y README)
- [ ] T7 `runAssistantTurn` sobre el puerto, con LLM falso: tool_use paralelo, `is_error`, tope de iteraciones, refusal/max_tokens (RF-10, RF-16)
- [ ] T8 Sesión por teléfono: código, verificación, límites (RF-1..4)
- [ ] T9 Rutas `/assistant/*` + tests de integración y de aislamiento por cuenta
- [ ] T10 Widget de chat en la página pública (Vitest)
- [ ] T11 Evals con el modelo configurado (RF-17), contra al menos un proveedor — pedir aprobación de costo antes de correr
- [ ] T12 README y docs actualizados
