# Tasks 008 — Endurecimiento de la API

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar. Backend en `backend/`,
frontend en `frontend/`. Sin migraciones ni dependencias nuevas.

**Rama:** `spec/008-endurecimiento-api` (ya creada, sobre la 007).

## Fase 0 — Línea base

- [x] **T00 · Línea base y reproducción de los defectos** — todas
  Con una DB limpia: `npm run db:migrate` y `npm test` en `backend/`, y `npm test`, `npm run lint`, `npm run build` y `npx tsc --noEmit` en `frontend/`. Debe haber **exactamente un** test en rojo: `inputHardening` (RF-10 de la spec 007). Guardar la salida de las reproducciones manuales del plan §8 (`GET /availability/abc`, `POST /staff` sin cuerpo, 30 logins fallidos, tiempos de login) para compararlas al final.
  **Hecho cuando:** se anota el conteo inicial y el único fallo, y las cuatro reproducciones muestran el defecto.

## Fase 1 — Errores seguros (lo más grave primero)

- [x] **T01 · `errorHandler`: `toResponse` y registro** — RF-1, RF-2, RF-3
  Test que falla en `tests/infrastructure/errorHandler.test.js`, luego reescribir `middleware/errorHandler.js` con `toResponse` puro y `createErrorHandler({ log })`.
  **Hecho cuando:** el test cubre: error de aplicación 4xx pasa tal cual; 4xx con mensaje en prosa → `bad_request`; error sin `status` y `status: 500` con mensaje SQL → exactamente `{ error: 'internal_error' }`; `entity.parse.failed` → 400 `invalid_body`; `entity.too.large` → 413; `charset.unsupported` → 415; el log recibe la traza y la ruta **sin** la query `?token=…` y no recibe cuerpo ni cabeceras.

- [x] **T02 · `createApp()` y tabla `ROUTES`** — RF-7 (preparación), RF-10, RF-16
  Extraer `http/createApp.js` (`express()`, `x-powered-by` desactivado, `trust proxy`, `express.json()`, `/health`, la tabla exportada `ROUTES` que monta, `errorHandler`); `app.js` queda como arranque. Hacer que `tests/helpers/apiServer.js` y `publicServer.js` usen `createApp()`, con `trust proxy` en 1 y un `X-Forwarded-For` propio por instancia (D-P7).
  **Hecho cuando:** toda la suite sigue como en T00 (solo el rojo conocido) y `apiServer.js` ya no monta rutas a mano.

- [x] **T03 · Guarda de UUID** — RF-5
  Test que falla en `tests/integration/hardening.test.js`: el **recorrido de rutas** (por cada `[mount, router]` de `ROUTES` y cada `layer.route`, `:param` → `abc`, token de owner válido → 404, o 401 en `public`; sin `select`, `Failed query` ni `password_hash` en el cuerpo) y `GET /availability/abc` **sin token** → 404. Luego `middleware/uuidParams.js` aplicado a `accounts`, `appointments`, `services`, `clients`, `staff` y `availability` (este último con código `service_not_found`).
  **Hecho cuando:** el recorrido pasa; quitar la guarda de un router hace fallar el test (se comprueba una vez a propósito).

- [x] **T04 · Filtros UUID inválidos** — RF-6
  Tests que fallan: `GET /appointments?employee_id=abc` → 400 `invalid_body`; en `listPayments` y `getPaymentsSummary` (unit), `employee_id: 'abc'` → resultado vacío / ceros sin consultar repositorios; e integración `GET /payments?employee_id=abc` → 200 vacío. Luego implementar en los dos casos de uso reusando la rama de rango vacío.
  **Hecho cuando:** los tres casos pasan y el comportamiento con `employee_id` UUID inexistente no cambió.

- [x] **T05 · Cuerpo de `POST /staff`** — RF-4
  Test que falla en `tests/application/inviteStaff.test.js` (ajustado para pasar `body`): `undefined`, `[]`, `null` → 400 `invalid_body`, y un actor staff recibe 403 **antes** que 400. Luego `inviteStaff(db, { accountId, actor, body })` con `parseInput` después del chequeo de rol, y `routes/staff.js` pasando `req.body` entero.
  **Hecho cuando:** pasan los unit y el test `inputHardening` de la 007 vuelve a verde (la suite queda sin rojos).

- [x] **T06 · Integración del manejador de errores** — RF-1, RF-3
  Tests en `hardening.test.js`: un repositorio forzado a lanzar con un mensaje SQL → respuesta exacta `{ error: 'internal_error' }`; JSON roto → 400 `invalid_body`; cuerpo de 200 KB → 413 `payload_too_large`; `Content-Type: application/json; charset=latin1` → 415; `text/plain` con cuerpo → 400 `invalid_body`.
  **Hecho cuando:** los cinco casos pasan sin cambios de código adicionales (si alguno falla, se corrige `errorHandler`).

## Fase 2 — Acceso y credenciales

- [x] **T07 · Contraseña: esquema `newPassword`** — RF-11
  Test que falla en `tests/domain/passwords.test.js`: 7, 8 y 72 bytes; 73 bytes; multibyte que supera 72 bytes aunque tenga pocos caracteres; 8 espacios → válida; ausente → `missing_fields`; número → `invalid_body`. Luego `newPassword()` en `schemas/common.js` y su uso en `registerBody`, en la activación de trabajador (`schemas/public.js`) y en `editSelfBody` (`schemas/staff.js`).
  **Hecho cuando:** el test pasa y las pruebas de formato de las specs 002 y 007 siguen verdes; los tests existentes con contraseñas cortas (por ejemplo `'clave'`) se actualizan a 8 caracteres o más.

- [x] **T08 · Contraseña en los tres puntos de entrada** — RF-11
  Tests de integración: `POST /auth/register` con 7 → 400 `invalid_password`, con 8 → 201; `PATCH /me` con 3 → 400 `invalid_password`; activación con 5 → 400; **login** con una contraseña corta ya existente sigue entrando.
  **Hecho cuando:** los cuatro casos pasan.

- [x] **T09 · `login` como caso de uso con comparación constante** — RF-12
  Test que falla en `tests/application/login.test.js` con `compare` espía: se invoca en email inexistente, `pendiente`, `inactivo`, sin hash y activo con clave mala (siempre 401 `invalid_credentials`); activo con clave buena devuelve el usuario. Luego `application/login.js` con `DUMMY_HASH` (costo 10) y usarlo en `routes/auth.js`.
  **Hecho cuando:** el test pasa y el tiempo medido contra el servidor real para email inexistente deja de ser ~40 veces menor que el de uno existente.

- [x] **T10 · JWT con algoritmo fijo** — RF-13
  Test que falla en `tests/infrastructure/jwt.test.js`: `alg: none`, otro secreto y token manipulado → `verifyToken` lanza; token propio ok. Luego `http/jwt.js` y reemplazar los `jwt.sign`/`jwt.verify` de `routes/auth.js` (dos) y `middleware/auth.js`.
  **Hecho cuando:** el test pasa y un `GET /appointments` con un token `alg: none` responde 401.

- [x] **T11 · Fábrica de limitadores y límites de auth** — RF-8, RF-9
  Test que falla en `hardening.test.js`: 10 logins fallidos → el 11.º es 429 con `Retry-After`; un login correcto no cuenta; 5 registros → el 6.º es 429. Luego `middleware/limiters.js` (`createLimiter`, `loginLimiter` 10/15 min con `skipSuccessfulRequests`, `registerLimiter` 5/60 min), aplicados en `routes/auth.js`, y rehacer los dos limitadores de `routes/public.js` con la misma fábrica.
  **Hecho cuando:** los dos tests pasan y los de `/public/*` de la spec 005 siguen verdes.

- [x] **T12 · IP real detrás del proxy** — RF-10
  Test que falla: con `trust proxy` 1, dos `X-Forwarded-For` distintos tienen cupos separados de login; con `trust proxy` 0 comparten el cupo. (La configuración ya está en `createApp`; se ajusta `createApp(config)` si hace falta.)
  **Hecho cuando:** ambos casos pasan y la ejecución no emite el `ValidationError` de `express-rate-limit` sobre `X-Forwarded-For`.

## Fase 3 — Configuración y robustez interna

- [x] **T13 · `loadConfig` y arranque que falla rápido** — RF-14, RF-15, RF-10
  Test que falla en `tests/infrastructure/config.test.js`: `JWT_SECRET` vacío o ausente, `TRUST_PROXY` `'uno'`/`'-1'`/`'1.5'`, `PORT` `'0'`/`'70000'`; en `production` secreto corto y secreto de ejemplo → error; en `development` con el de ejemplo → ok; el mensaje no contiene el secreto. Luego `infrastructure/config.js`, `app.js` lo invoca al arrancar e imprime el error con código 1 sin abrir el puerto.
  **Hecho cuando:** el test pasa y, a mano, `JWT_SECRET= node src/infrastructure/http/app.js`, `TRUST_PROXY=uno …` y `NODE_ENV=production` con el secreto de ejemplo terminan con código distinto de cero sin escuchar.

- [x] **T14 · Sin consultas concurrentes en transacciones** — RF-20
  Test que falla en `tests/application/createPayment.test.js` (repositorio que detecta solapamiento) y test de integración que captura `process.on('warning')` mientras se crea un turno pasado con pago y se ejecuta `seedDemo`. Luego `createPayment` con `await` secuenciales.
  **Hecho cuando:** ambos pasan y `npm run db:seed` ya no imprime la advertencia de `pg`.

## Fase 4 — Cabeceras, Docker y nginx

- [x] **T15 · Cabeceras de la API** — RF-16
  Test que falla en `hardening.test.js`: `x-powered-by` ausente; `nosniff`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store` en respuestas 200, 404 y 500 y en `/health`. Luego `middleware/securityHeaders.js` montado en `createApp`.
  **Hecho cuando:** el test pasa.

- [x] **T16 · nginx: cabeceras del frontend** — RF-17
  Crear `frontend/security-headers.conf`, copiarlo en el `Dockerfile` e incluirlo en `location /` y `location /assets/` de `nginx.conf`; no en `/api/`.
  **Hecho cuando:** `docker build ./frontend` termina bien y, con el entorno levantado, `curl -I` a `/`, a un archivo de `/assets/` y a `/assets/nada.js` muestra las tres cabeceras, y a `/api/health` muestra `nosniff` una sola vez. (Sin Docker disponible, queda para la CI de T19.)

- [x] **T17 · Compose: puerto local y `TRUST_PROXY`** — RF-18, RF-19
  `backend.ports: "127.0.0.1:${BACKEND_PORT:-3000}:3000"` y `TRUST_PROXY: 1` con comentario; documentar `TRUST_PROXY` en `backend/.env.example`.
  **Hecho cuando:** `docker compose config -q` no da errores y el test del README (spec 006 RF-10) sigue verde.

## Fase 5 — Frontend y CI

- [x] **T18 · Pantalla de acceso y verificación de tipos** — RF-21, RF-22
  Test que falla en `LoginPage.test.tsx`: la API responde `too_many_requests` / `invalid_password` → se muestran los mensajes en español y no el código; el campo de contraseña del registro tiene `minLength=8`. Luego `LoginPage.tsx` y el script `typecheck` en `package.json`.
  **Hecho cuando:** el test pasa y `npm run typecheck` sale con código 0.

- [x] **T19 · CI** — RF-22
  En `ci.yml`: paso `npm run typecheck` en el job `frontend`; en `smoke`, pasos con `curl -sI` que comprueban las tres cabeceras en `/`, en un archivo de `/assets/` (nombre leído del `index.html`) y en `/assets/no-existe.js`, y que `/api/health` trae `nosniff` exactamente una vez.
  **Hecho cuando:** el YAML valida localmente y cada comando de los pasos nuevos se ejecuta con el resultado esperado contra el entorno local.

## Fase 6 — Documentación y cierre

- [x] **T20 · README y diseño** — RF-23
  README: sección "Seguridad" (qué protege el sistema ahora) y "Límites conocidos" actualizada (JWT de 7 días sin revocación, sin CSP ni HSTS, límites en memoria por proceso, sin recuperación de contraseña), con `TRUST_PROXY` documentado; `docs/diseno-gestor-turnos.md` §4 con los códigos nuevos.
  **Hecho cuando:** el test del README sigue verde y los límites no contradicen la spec.

- [x] **T21 · Gate final y verificación contra el servidor real** — todos los RF
  Backend: `npm test` en `TZ=UTC` y `TZ=America/Argentina/Buenos_Aires`, y `npm run db:migrate` sobre DB vacía. Frontend: `npm test`, `npm run lint`, `npm run build`, `npm run typecheck`. Repetir las reproducciones guardadas en T00.
  **Hecho cuando:** todos los comandos salen con código 0 y las cuatro reproducciones ya no muestran el defecto (`GET /availability/abc` → 404 sin SQL; `POST /staff` sin cuerpo → 400; el 11.º login fallido → 429; los tiempos de login de email existente e inexistente son comparables).

---

## Estado: implementado (415/415 tests de backend en verde en `UTC`, `America/Argentina/Buenos_Aires` y `Asia/Tokyo`; 91/91 de frontend)

Verificado contra el servidor real (`app.js`, base con la demo sembrada), las mismas pruebas que detectaron los defectos:

| Defecto | Antes | Ahora |
|---|---|---|
| `GET /availability/abc` sin token | 500 con el SQL completo | 404 `service_not_found` |
| `GET /appointments/abc`, `/staff/abc`, `/services/abc`, `/staff/abc/availability` | 500 con SQL | 404 `not_found` |
| `GET /payments?employee_id=abc` / `GET /appointments?employee_id=abc` | 500 | 200 vacío / 400 `invalid_body` |
| `POST /staff` sin cuerpo | 500 | 400 `invalid_body` |
| `POST /staff` con `[]` | 400 `missing_fields` | 400 `invalid_body` |
| 30 logins fallidos | 30 × 401 | 10 × 401, luego 429 |
| Tiempo de login (inexistente / existente) | 0,9 ms / 36 ms | 36 ms / 37 ms |
| Error inesperado (nombre de 300 caracteres) | 500 con el SQL | 500 `internal_error`, traza solo en el log, sin la query `?token=` |
| JSON roto / cuerpo de 200 KB | mensaje del parser / 413 con texto | 400 `invalid_body` / 413 `payload_too_large` |
| `X-Powered-By`, `nosniff`, `Referrer-Policy`, `Cache-Control` | `X-Powered-By` presente, sin las otras | ausente / presentes |
| Arranque con `JWT_SECRET` vacío, `TRUST_PROXY=uno`, `PORT=0`, producción con secreto de ejemplo o corto | arrancaba | código 1 con el nombre de la variable |

**Desviaciones del plan** (todas descubiertas al implementar):

- **D11 (`spec.md`):** el código `date_from, date_to, service_id required`, prosa con espacios que la spec 007 había preservado, pasa a `missing_fields`. Ningún consumidor lo usaba.
- **`GET /appointments?employee_id=abc` daba 500:** su esquema solo exigía `string`, no `optionalUuid` como suponía el plan. Se valida en el caso de uso, después del rol, para respetar que un staff ignora ese filtro (spec 001 RF-42).
- **Filtro de pagos:** un `employee_id` no UUID se consulta como el UUID nulo (`uuidOrNil`) en vez de reusar la rama de rango vacío; misma respuesta, menos código.
- **Test de la spec 007 en rojo:** `inputHardening` (RF-10) fallaba por `POST /staff`; quedó resuelto con T05.
- **`tests/helpers/apiServer.js`:** cada llamada manda un `X-Forwarded-For` distinto por defecto (no uno por instancia, como decía D-P7): con uno por instancia, `inputHardening` agotaba el cupo de registro. `opts.ip` fija una IP para los tests de límites.
- **`charset=utf-16` no da 415:** `body-parser` lo soporta (decodifica y el JSON falla → 400 `invalid_body`); un charset no soportado es `latin1`. Se corrigió el caso en la spec y el test.
- **`LoginPage` ya tenía `minLength={8}` también en modo login**, lo que habría bloqueado en el navegador a usuarios con contraseñas cortas (contra RF-11). Ahora solo rige al registrarse. Además `LoginPage` mostraba el código crudo ante cualquier error desconocido; ahora muestra un mensaje genérico.
- **Verificación de infraestructura pendiente:** no hay Docker daemon ni `nginx` en este entorno; las cabeceras de nginx (RF-17), el `127.0.0.1:` de Compose (RF-18) y `TRUST_PROXY=1` detrás del proxy real (RF-19) se verifican en la CI de GitHub (job `smoke`, con `.github/scripts/check-headers.sh`, probado aquí contra el backend). `docker compose config -q` valida.

**Observaciones fuera de alcance** (no se tocaron):

- Una ruta inexistente (`GET /no-existe`) devuelve el HTML por defecto de Express, no `{ "error": "not_found" }`.
- Un nombre de más de 255 caracteres produce un 500 (ya sin filtrar nada) en lugar de un 400: faltan límites de longitud en los esquemas.
- El lint del frontend mantiene 2 avisos preexistentes (`AuthContext`, `DashboardPage`).
