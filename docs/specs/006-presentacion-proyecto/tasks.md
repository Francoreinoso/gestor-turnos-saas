# Tasks 006 — Presentación del proyecto: README, datos demo, Docker y CI

Deriva de `plan.md`. Tareas de <30 min, en orden de dependencia. Cada una con
sus RF y una condición verificable. TDD: donde dice "test que falla", ese
test se escribe y se ve fallar antes de implementar. Backend en `backend/`,
frontend en `frontend/`. Sin migraciones de esquema.

**Precondición:** spec 005 implementada y mergeada (rutas públicas, Vitest,
`errorHandler`, pantallas públicas). Una rama para esta spec:
`spec/006-presentacion-proyecto`.

## Fase 0 — Línea base

- [x] **T00 · Línea base verde** — todas
  Con una DB limpia: `npm run db:migrate` y `npm test` en `backend/`; `npm test`, `npm run lint` y `npm run build` en `frontend/`; y `TZ=UTC npm test` en el backend.
  **Hecho cuando:** todos salen con código 0 y se anota el conteo de tests inicial.

## Fase 1 — Salud del backend

- [x] **T01 · `GET /health`** — RF-15
  Test que falla en `tests/integration/health.test.js` (servidor efímero, como el de la spec 005): con `ping` real → 200 `{ status: 'ok' }`; con `ping` que lanza → 503 `{ status: 'unavailable' }` y el cuerpo **no** contiene el mensaje del error; ambos sin cabecera de autenticación. Luego `routes/health.js` (`createHealthRouter({ ping })`, límite de 2 s) y montarlo en `app.js` antes de cualquier limitador.
  **Hecho cuando:** los tres casos pasan y `curl localhost:3000/health` responde 200 con el servidor real.

## Fase 2 — Seed (dominio puro, luego integración)

- [x] **T02 · `nextBusinessDay`** — RF-28
  Test que falla en `tests/domain/nextBusinessDay.test.js`, luego la función pura (exportada desde `db/seed.js` o un módulo de apoyo).
  **Hecho cuando:** el test cubre: nunca devuelve el día de `now`; un viernes con `k=1` → lunes; sábado y domingo → lunes; `k` consecutivos son días distintos; `now` a las 23:59 no devuelve el mismo día.

- [x] **T03 · `seedDemo` — cuenta, usuarios, servicios, clientes** — RF-19, RF-20
  Test que falla en `tests/integration/seed.test.js` (con `accountId` y `emailPrefix` aleatorios y limpieza al final): 1 owner, 2 profesionales `activo` con contraseña hasheada que valida con `bcrypt.compare` y comisiones distintas, 3 servicios, historial de precio con 2+ entradas para el servicio cuyo precio cambió, 4 clientes. Luego implementar esa parte de `seedDemo` dentro de una `db.transaction`.
  **Hecho cuando:** el test pasa.

- [x] **T04 · `seedDemo` — horarios y turnos** — RF-19, RF-20, RF-28
  Test que falla: horarios vía `replaceStaffAvailability` (lunes a viernes, tramos de los dos profesionales parcialmente solapados); ≥6 `completado` con pago de comisión coherente (`employee_amount + business_amount = amount`, tasa del profesional); ≥4 `agendado` con token, en días hábiles, dentro de la ventana del profesional asignado, completos y sin solaparse entre sí; 1 bloqueo futuro; 1 `cancelado`. Luego implementarlo con `createAppointmentFromPanel` y repositorios.
  **Hecho cuando:** el test pasa, incluida la comprobación de que `listAvailableSlots` ofrece horarios para "Cualquiera" en los próximos días hábiles.

- [x] **T05 · `seedDemo` — idempotencia, `ifMissing`, atomicidad, producción** — RF-21..RF-24
  Test que falla: dos ejecuciones → una sola cuenta con ese id y una cuenta ajena creada antes sigue intacta; `ifMissing` con la cuenta existente → `{ skipped: true }` y los ids de los turnos no cambian; un repositorio inyectado que lanza a mitad → la cuenta anterior conserva sus datos originales; `env.NODE_ENV = 'production'` → rechaza sin escribir nada; borrado en cascada de una cuenta con turnos **y pagos** (fija D-P4). Luego implementarlo.
  **Hecho cuando:** los cinco casos pasan.

- [x] **T06 · Línea de comandos del seed** — RF-24, RF-25, RF-26
  Arranque protegido en `db/seed.js` (no ejecuta al importarse), flag `--if-missing`, comprobación de base migrada con mensaje `ejecutá npm run db:migrate primero`, resumen impreso con `FRONTEND_URL` (credenciales, `bookingPath` y `managePath`) y código de salida distinto de cero ante error; script `"db:seed"` en `package.json`.
  **Hecho cuando:** sobre una base migrada, `npm run db:seed` imprime el resumen y termina en 0; sobre una base vacía imprime el mensaje de migrar y termina en distinto de 0; con `NODE_ENV=production` se niega y termina en distinto de 0; una segunda corrida con `--if-missing` termina en 0 sin cambios.

## Fase 3 — Docker

- [x] **T07 · Backend: `.dockerignore` y `Dockerfile`** — RF-16
  `.dockerignore` (`node_modules`, `.env*` salvo el ejemplo, `tests`, `*.log`, `.git`); `Dockerfile` con `npm ci --omit=dev`, `USER node` y `HEALTHCHECK` de `/health`, sin definir `NODE_ENV`.
  **Hecho cuando:** `docker build ./backend` termina bien; con un `.env` de prueba en `backend/`, `docker run --rm <img> ls -a /app` no lista `.env` ni `tests`; el contenedor corre como `node` (`id -un`).

- [x] **T08 · Frontend: `Dockerfile`, `nginx.conf`, `.dockerignore`** — RF-17
  Multi-etapa (`node:22-alpine` → `nginx:alpine`); `/api/` con `proxy_pass http://backend:3000/`; `try_files $uri /index.html`; cache largo solo en `/assets/`.
  **Hecho cuando:** `docker build ./frontend` termina bien y la imagen contiene `dist` y no `node_modules`.

- [x] **T09 · `.env.example` y `docker-compose.yml`** — RF-11..RF-14, RF-17, RF-18
  Reescribir `.env.example` raíz (valores de desarrollo, `SEED_DEMO`, `TZ`, puertos) y alinear `backend/.env.example`; Compose con `db` (healthcheck `pg_isready`), `setup` (migra y siembra con `--if-missing` si `SEED_DEMO=true`), `backend` y `frontend` con healthchecks, `DATABASE_URL` derivada y `NODE_ENV: development`.
  **Hecho cuando:** `docker compose config -q` no da errores y el `.env` raíz ya no contiene `DATABASE_URL`.

- [ ] **T10 · Prueba de humo local del inicio rápido** — RF-13, RF-17, RF-22
  Desde un directorio limpio (clon nuevo): `cp .env.example .env` y `docker compose up --build --wait`. Comprobar `/health` (200), `GET :5173/api/public/accounts/00000000-0000-4000-8000-000000000001` (200 con 3 servicios), `:5173/reservar/00000000-0000-4000-8000-000000000001` (200 HTML) y el login del owner demo. Luego `down` + `up` sin `-v` (la demo no se recrea) y `down -v` + `up` (se vuelve a sembrar). Forzar una migración rota y comprobar que `backend` no arranca y `docker compose logs setup` muestra el motivo.
  **Hecho cuando:** los siete comprobaciones se cumplen.

## Fase 4 — README

- [x] **T11 · Test del README (rojo)** — RF-10
  Test que falla en `tests/docs/readme.test.js`: con README sintético detecta un `npm run` inexistente, una variable de `.env.example` sin documentar y un enlace relativo roto; sobre el README real exige que no haya ninguno de los tres y que aparezca el UUID fijo de la demo. Falla porque el README no existe.
  **Hecho cuando:** el test se ve fallar sobre el README real y pasar sobre el sintético correcto.

- [x] **T12 · `README.md`** — RF-1..RF-9, RF-27
  Escribir el README con todas las secciones de RF-1 y los contenidos de plan §4 (insignia, inicio rápido de 3 comandos, camino sin Docker, usuarios demo con advertencia, tabla de roles, límites y pendientes incluidos capturas y licencia, decisiones técnicas con enlaces al diseño, metodología con enlaces a constitución y specs, estructura del repo).
  **Hecho cuando:** el test de T11 pasa y una persona ajena al proyecto (o una lectura en frío) responde qué es, cómo se levanta y qué falta sin abrir otro archivo.

## Fase 5 — CI

- [x] **T13 · Workflow de CI** — RF-29..RF-33
  `.github/workflows/ci.yml` con los tres jobs del plan §3 (`backend` en matriz de `TZ`, `frontend`, `smoke`), permisos mínimos, `concurrency` y caché de npm.
  **Hecho cuando:** el YAML pasa una validación sintáctica local (por ejemplo `actionlint` o `python -c 'import yaml; yaml.safe_load(...)'`) y los comandos de cada paso se ejecutan localmente con el mismo resultado esperado.

## Fase 6 — Documentación de proceso

- [x] **T14 · Enmienda de la constitución** — RF-34
  Editar el principio 1 de `docs/constitution.md` y agregar la línea de enmienda con fecha; **en un commit propio**, con un mensaje que explique por qué (el backend es JavaScript con módulos ES y el frontend, TypeScript).
  **Hecho cuando:** el diff del commit toca solo la constitución y los demás principios quedan intactos.

- [x] **T15 · Diseño coherente** — RF-35
  Actualizar `docs/diseno-gestor-turnos.md` §5 (árbol real), §6 (pendientes) y la nota de `/health`; revisar `grep -rniE "typescript|schema\.ts|drizzle\.config\.ts" docs README.md` para que ninguna mención quede apuntando al backend.
  **Hecho cuando:** el `grep` solo devuelve menciones correctas (frontend en TypeScript, enmienda histórica) y T11 sigue en verde.

## Fase 7 — Cierre

- [ ] **T16 · Gate final** — todos los RF
  Backend: `npm test` y `npm run db:migrate` sobre DB vacía; frontend: `npm test`, `npm run lint`, `npm run build`; backend también con `TZ=America/Argentina/Buenos_Aires`; repetir T10 desde un clon limpio con cronómetro.
  **Hecho cuando:** todos los comandos salen con código 0 y el inicio rápido completo, desde `git clone` hasta ver la agenda del owner y la reserva pública, lleva menos de 5 minutos sin ningún comando extra.

- [ ] **T17 · CI en GitHub** — RF-29..RF-33
  Con un `push` de la rama (acción que decide el usuario), comprobar que los tres jobs pasan; si el humo falla por tiempos de construcción, ajustar `--wait-timeout` y no los comandos.
  **Hecho cuando:** el workflow aparece en verde y la insignia del README refleja el estado.
