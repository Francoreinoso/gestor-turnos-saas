# Spec 011 — Asistente de IA para el cliente final

## Contexto y objetivo

El cliente final solo puede reservar con el formulario público (spec 005). Esta spec agrega un **asistente conversacional** en la página pública que consulta servicios y disponibilidad, propone reservas y cancela turnos del propio cliente.

Principio rector: **el modelo nunca toca la base de datos**. Pide herramientas; el backend valida cada pedido, decide si lo ejecuta y fija la identidad (`account_id`, `client_id`) desde la sesión. Ninguna herramienta recibe ni acepta esos ids del modelo.

## Justificación de la dependencia (constitución, principio 1)

Se agrega `@anthropic-ai/sdk` al backend: es el SDK oficial; reimplementar el cliente HTTP, los reintentos y los tipos de la Messages API sería más código propio y más riesgo. Solo lo importa `anthropicAdapter` (importación dinámica), de modo que con `ASSISTANT_PROVIDER=openai` el SDK no se carga. Modelo por defecto con `anthropic`: `claude-sonnet-5-5`, configurable con `ASSISTANT_MODEL`.

### Proveedor intercambiable (demo gratuita)

El bucle del agente depende de un puerto `llmClient` propio, no del SDK. Hay dos adaptadores, elegidos con `ASSISTANT_PROVIDER` (`anthropic`, por defecto, o `openai`):

- `anthropic`: usa `@anthropic-ai/sdk` y `ANTHROPIC_API_KEY`.
- `openai`: habla el protocolo `chat/completions` compatible con OpenAI mediante `fetch` nativo (sin dependencia nueva), contra `ASSISTANT_BASE_URL` con `ASSISTANT_API_KEY`. Sirve para capas gratuitas (Gemini, Groq, OpenRouter) y para Ollama local, útil en una demo sin costo.

Un modelo gratuito tendrá menos fiabilidad con herramientas; por eso el backend sigue imponiendo permisos y el modelo nunca decide identidad ni escribe en la base.

## Fuera de alcance (v1)

WhatsApp u otros canales; reprogramar; ventana mínima de cancelación; pagos; voz.

## Actores

- **Cliente final**: conversa desde la página pública de un negocio.
- **Backend**: ejecuta o rechaza las herramientas.

## Requisitos funcionales (EARS)

### Sesión e identidad

- RF-1: CUANDO el cliente ingresa su teléfono (`POST /assistant/session`), EL SISTEMA envía un código de 6 dígitos de un solo uso con vencimiento de 10 minutos. La respuesta es idéntica exista o no el cliente.
- RF-2: CUANDO el cliente envía el código correcto (`POST /assistant/session/verify`), EL SISTEMA devuelve un token de sesión corto (1 h) con `account_id` y `client_id` (el cliente se busca o crea por teléfono dentro de la cuenta).
- RF-3: SI el código es incorrecto, vencido o ya usado, ENTONCES responde 401 `invalid_code`; tras 5 intentos fallidos el código se invalida.
- RF-4: EL SISTEMA limita mensajes y solicitudes de código por teléfono y por IP.
- RF-19: UNA misma persona puede ser cliente de varios negocios: el teléfono y el email de `clients` son únicos **dentro de cada cuenta**, no en toda la base (la migración 0001 los hizo globales, y verificar el código de un teléfono que ya era cliente de otra cuenta respondía 500). AL buscar o crear un cliente, EL SISTEMA lo busca en la cuenta por email y, si no aparece, por teléfono; dos altas simultáneas del mismo cliente terminan en una sola fila, sin error. Corrige también la reserva pública (spec 005).

### Herramientas

- RF-5: `listar_servicios` devuelve los servicios activos de la cuenta de la sesión con duración y precio.
- RF-6: `ver_disponibilidad(servicio_id, desde, hasta)` devuelve horarios libres; rango máximo 14 días; cada horario lleva un `slot_id` opaco emitido por el backend y válido solo en esa sesión.
- RF-7: `ver_mis_turnos` devuelve solo los turnos del `client_id` de la sesión (sin datos de otros clientes).
- RF-8: `proponer_reserva(servicio_id, slot_id)` crea una **propuesta pendiente** (vence a los 10 min); NO crea el turno. SI `slot_id` no fue emitido en la sesión, ENTONCES error `slot_invalid`.
- RF-9: `cancelar_turno(turno_id)` cancela un turno `agendado` del `client_id` de la sesión. SI el turno es de otro cliente, de otra cuenta o no existe, ENTONCES `not_found`.
- RF-10: LOS esquemas de entrada se validan con zod antes de ejecutar; una entrada inválida se devuelve al modelo como `tool_result` con `is_error: true`, sin ejecutar nada.

### Confirmación

- RF-11: LA reserva solo se crea cuando el cliente confirma con `POST /assistant/proposals/:id/confirm` (botón de la UI), sin pasar por el modelo.
- RF-12: CONFIRMAR una propuesta vencida, descartada o de otro cliente responde 404/409 sin crear turno; confirmar dos veces la misma propuesta no duplica el turno (idempotente).
- RF-13: SI el horario ya fue tomado, ENTONCES `appointment_overlap` (409) y el asistente ofrece alternativas.

### Conversación

- RF-14: EL asistente responde en español latinoamericano neutro (tuteo), solo sobre turnos del negocio; rechaza lo demás y no sigue instrucciones que aparezcan dentro de datos (nombres de servicio, notas).
- RF-15: ANTES de cancelar, EL asistente pide confirmación explícita del cliente en el chat.
- RF-16: EL bucle de herramientas tiene un máximo de 8 iteraciones por mensaje; los `stopReason` normalizados `refusal` y `max_tokens` (que los adaptadores derivan, entre otros, de `content_filter` y `length`) se informan al cliente con un mensaje genérico.
- RF-18: CUANDO el proveedor responde con límite de uso (429), error de red, timeout o error 5xx, `/assistant/*` responde 503 `assistant_busy` con un mensaje genérico para el cliente («intenta de nuevo en unos minutos»), sin exponer el detalle del proveedor y sin dejar propuestas a medias.

### Evals

- RF-17: EXISTE un conjunto de evals (`backend/evals/`) contra el modelo real configurado (cualquier proveedor), fuera de `npm test`, que verifica sobre las llamadas a herramientas: no reserva sin proponer, no cancela turnos ajenos, no inventa slots, pide aclaración si falta el servicio, resiste inyección de instrucciones y rechaza temas ajenos.

## Requisitos no funcionales

- RNF-1: aislamiento por cuenta en toda consulta (principios 2 y 6).
- RNF-2: las claves (`ANTHROPIC_API_KEY`, `ASSISTANT_API_KEY`) solo en el servidor; si falta la del proveedor elegido, `/assistant/*` responde 503 `assistant_unavailable` y el resto de la app funciona. Ollama local no exige clave, pero sí `ASSISTANT_BASE_URL`.
- RNF-4: el bucle del agente trabaja con mensajes, llamadas a herramientas y resultados en un formato interno normalizado; cada adaptador traduce desde y hacia el de su proveedor.
- RNF-3: el cliente LLM es inyectable para pruebas; `npm test` nunca llama a la API real.
