# Spec 006 — Presentación del proyecto: README, datos demo, Docker y CI

## Contexto y objetivo

El sistema ya cubre el flujo completo (turnos, staff, pagos, disponibilidad y reserva pública), pero quien clona el repositorio no puede entenderlo ni probarlo sin leer el código: **no hay README**, no hay datos de ejemplo, `docker compose up` levanta la base y el backend pero **no aplica las migraciones**, el `.env.example` de la raíz tiene todos los valores vacíos (y `DATABASE_URL` duplica a mano lo que ya dicen las variables de Postgres), y no hay integración continua que pruebe nada. Además el `Dockerfile` del backend copia todo el directorio —incluido un `.env` local o `node_modules`— porque no existe `.dockerignore`.
Esta spec define lo necesario para que un revisor entienda el proyecto en un minuto, lo ejecute con pocos comandos, lo explore con datos realistas y confíe en que lo que lee es cierto porque una CI lo verifica. **Depende de la spec 005** implementada (pantallas públicas, endpoints públicos y Vitest en el frontend): el README las describe y la CI las prueba.

## Usuarios / actores

- **Revisor**: persona que evalúa el proyecto (reclutadora, tech lead, colega). Clona, lee, levanta y explora; no conoce el dominio.
- **Contribuidor**: desarrolla en el repo; necesita saber cómo correr tests y qué proceso se sigue.
- **CI**: el sistema que verifica cada cambio sin intervención humana.

## Glosario

- **Inicio rápido**: la secuencia mínima de comandos que lleva de un clon limpio a la aplicación funcionando con datos demo.
- **Cuenta demo**: el negocio de ejemplo que crea el seed; se identifica por el email de su owner.
- **Seed**: el script `npm run db:seed` del backend.
- **Humo (smoke)**: verificación mínima de que el sistema arranca y responde, sin probar reglas de negocio.

## Historias de usuario

- H1: Como revisor quiero saber qué es el proyecto, qué resuelve y cómo está construido sin abrir ningún archivo de código.
- H2: Como revisor quiero levantar todo con muy pocos comandos y ver la aplicación funcionando.
- H3: Como revisor quiero entrar con usuarios de ejemplo y ver una agenda, pagos y horarios reales para evaluar el producto.
- H4: Como revisor quiero conocer con honestidad qué falta o qué limitaciones tiene.
- H5: Como contribuidor quiero correr los tests y entender el proceso (constitución, specs) antes de tocar nada.
- H6: Como contribuidor quiero que cada cambio se verifique automáticamente y que un README desactualizado se detecte.

## Requisitos funcionales (criterios de aceptación en EARS)

### README

- RF-1: EL SISTEMA incluye un `README.md` en la raíz, en español, con estas secciones y en este orden: qué es y qué problema resuelve; funcionalidades; stack; arquitectura; inicio rápido; usuarios de ejemplo y roles; API; decisiones técnicas; tests; metodología de trabajo; límites conocidos y roadmap; estructura del repositorio.
- RF-2: EL README ofrece un inicio rápido con Docker de como máximo 3 comandos (clonar, copiar `.env.example` a `.env`, `docker compose up`), tras los cuales la aplicación queda funcionando con datos demo, e indica las URL de cada servicio, incluida la de reserva pública de la cuenta demo (RF-27).
- RF-3: EL README ofrece un camino alternativo sin Docker para el desarrollo (base local, migraciones, backend y frontend por separado) con los scripts exactos.
- RF-4: EL README incluye la tabla de roles (owner, staff, cliente anónimo) con lo que cada uno puede hacer, coherente con el diseño §3.10 y las specs 001–005.
- RF-5: EL README documenta los usuarios de ejemplo y su contraseña, con la advertencia de que son solo para desarrollo.
- RF-6: EL README incluye la sección de límites conocidos y pendientes, sin ocultar ninguno de estos: el cálculo de horarios usa la hora local del servidor (sin zonas horarias por negocio); no se envían notificaciones al cliente (el enlace de gestión se muestra en pantalla); el panel solo muestra la agenda (no hay pantallas para gestionar servicios, staff ni horarios, que existen solo como API); la activación de un trabajador invitado no tiene pantalla; el owner no atiende turnos y la spec 001 aún permite asignarle uno de forma explícita; faltan capturas de pantalla en el README; el repositorio no declara licencia por el momento.
- RF-7: EL README resume las decisiones técnicas con mayor valor de portafolio y enlaza a su detalle en `docs/diseno-gestor-turnos.md`: trigger y `EXCLUDE` contra solapamientos, tokens de acceso hasheados para el cliente sin login, aislamiento por cuenta con 404 en vez de 403, baja lógica, transacciones, clean architecture.
- RF-8: EL README muestra el estado de la CI mediante una insignia (badge) del workflow.
- RF-9: EL README explica en un párrafo la metodología (constitución → spec → plan → tasks, una rama por spec, TDD) y enlaza a `docs/constitution.md` y `docs/specs/`.

### README que no miente

- RF-10: EL SISTEMA verifica con un test automatizado que cada `npm run <script>` mencionado en el README existe en el `package.json` correspondiente (backend o frontend, según el directorio indicado), que cada variable de `.env.example` está mencionada en el README, y que cada enlace relativo a un archivo o carpeta del repo apunta a algo que existe.

### Entorno y Docker

- RF-11: EL `.env.example` de la raíz trae valores de desarrollo que funcionan tal cual al copiarlo a `.env`, sin secretos reales y con un aviso de que `JWT_SECRET` debe cambiarse fuera de desarrollo. Todas sus variables aparecen en el README (RF-10).
- RF-12: EL SISTEMA no exige escribir `DATABASE_URL` en el `.env` raíz para Docker: `docker-compose.yml` la deriva de las variables de Postgres, de modo que no puedan contradecirse.
- RF-13: CUANDO se ejecuta `docker compose up`, EL SISTEMA espera a que la base responda, ejecuta un servicio de un solo uso (`setup`) que aplica las migraciones y, si `SEED_DEMO` es `true`, siembra la cuenta demo solo si todavía no existe (RF-22), y recién entonces arranca el backend; si una migración falla, el backend no arranca y el error es visible en `docker compose logs setup`.
- RF-14: EL SISTEMA define un chequeo de salud de la base (`pg_isready`) y del backend, y los servicios dependientes esperan a que estén sanos.
- RF-15: CUANDO se solicita `GET /health`, EL SISTEMA responde 200 `{ "status": "ok" }` si la base responde, y 503 `{ "status": "unavailable" }` si no; no requiere autenticación ni expone datos internos.
- RF-16: EL `Dockerfile` del backend instala solo dependencias de producción, corre con un usuario sin privilegios y no incluye en la imagen `.env`, `node_modules` locales ni los tests (mediante `.dockerignore`).
- RF-17: CUANDO se ejecuta `docker compose up`, EL SISTEMA construye y sirve también el frontend en `http://localhost:5173`, y reenvía `/api` al backend quitando el prefijo, con el mismo comportamiento que el proxy de desarrollo de Vite; las rutas del navegador (`/reservar/...`, `/turno/...`, `/owner/...`) responden con la aplicación y no con un 404 del servidor. Un único `docker compose up` basta para usar el sistema completo.
- RF-18: EL SISTEMA fija la variable `TZ` de los contenedores a partir del `.env` (por defecto `America/Santiago`), y el README explica que navegador y servidor deben compartir zona.

### Datos demo (seed)

- RF-19: CUANDO se ejecuta `npm run db:seed` contra una base migrada, EL SISTEMA crea la cuenta demo con un identificador fijo y documentado (`00000000-0000-4000-8000-000000000001`), de modo que su enlace de reserva sea siempre el mismo, y con: 1 owner; 2 profesionales `activo` con comisiones distintas; 3 servicios, cada uno con su historial de precio; horarios semanales de lunes a viernes cuyos tramos de los dos profesionales se solapan en parte (para que "Cualquiera" tenga sentido); 4 clientes; al menos 6 turnos `completado` de los últimos 14 días con su pago; al menos 4 turnos `agendado` en los próximos 7 días, con su token de acceso; 1 bloqueo futuro; y 1 turno `cancelado`.
- RF-20: EL SISTEMA crea los turnos, los pagos y los horarios a través de los casos de uso existentes (alta de turnos del panel, que a su vez registra el pago de los ya ocurridos, y reemplazo del horario semanal), y el resto de los datos (cuenta, usuarios, servicios con su historial, clientes, bloqueo) a través de los repositorios; nunca con SQL escrito a mano. Así los datos respetan las mismas reglas que la aplicación (solapamientos, comisiones, historial de precios).
- RF-21: CUANDO la cuenta demo ya existe, EL SISTEMA la elimina junto con todos sus datos y la vuelve a crear con fechas relativas a hoy, de modo que ejecutar el seed N veces deje siempre exactamente una cuenta demo; no toca ninguna otra cuenta.
- RF-22: CUANDO se ejecuta el seed con la opción `--if-missing` y la cuenta demo ya existe, EL SISTEMA no modifica nada y termina con código 0; es la forma en que `docker compose up` siembra sin pisar el estado de la demo en cada reinicio.
- RF-23: EL SISTEMA ejecuta el seed completo en una sola transacción: si algo falla no queda una cuenta demo a medias ni se pierde la anterior.
- RF-24: SI `NODE_ENV` es `production`, ENTONCES EL SISTEMA se niega a ejecutar el seed, termina con código distinto de cero y no escribe nada.
- RF-25: SI la base no tiene las migraciones aplicadas, ENTONCES EL SISTEMA termina con un mensaje que indica ejecutar `npm run db:migrate` primero.
- RF-26: AL terminar, EL SISTEMA imprime las credenciales del owner y de los dos profesionales, el enlace de reserva pública de la cuenta demo (`/reservar/:accountId`) y el enlace de gestión de uno de los turnos agendados (este último cambia en cada ejecución porque contiene un token nuevo).
- RF-27: EL README documenta los emails y la contraseña de los usuarios demo y el enlace de reserva pública con el identificador fijo de RF-19; no depende de leer los logs.
- RF-28: LOS turnos agendados futuros del seed caen en días y horarios dentro de la disponibilidad de su profesional y no se solapan entre sí; el resto del horario queda libre para reservar.

### Integración continua

- RF-29: EL SISTEMA define un workflow de GitHub Actions que corre en cada `push` a `main` y en cada `pull_request`, con permisos mínimos (solo lectura del contenido) y cancelando ejecuciones anteriores de la misma rama.
- RF-30: EL JOB de backend usa Node 22 (la versión del `Dockerfile`), un servicio de Postgres 17 con chequeo de salud, instala con `npm ci`, aplica las migraciones y corre `npm test`; se ejecuta con `TZ=UTC` y con `TZ=America/Santiago`.
- RF-31: EL JOB de frontend instala con `npm ci` y corre el lint, los tests y el build.
- RF-32: EL JOB de humo copia `.env.example` a `.env`, construye las imágenes, levanta el entorno con `docker compose up --wait` (sin pasos manuales adicionales) y comprueba: `GET /health` → 200; `GET /api/public/accounts/<id fijo>` a través del frontend → 200 con servicios; y la página `/reservar/<id fijo>` del frontend → 200 con el HTML de la aplicación. Esto verifica que el inicio rápido del README funciona y que el proxy `/api` y el fallback de rutas del frontend andan.
- RF-33: EL workflow fija las versiones de las acciones a una versión mayor y cachea las dependencias de npm.

### Documentación de proceso

- RF-34: EL SISTEMA enmienda el principio 1 de la constitución para que describa el stack real: backend en JavaScript con módulos ES (Node + Express 5), frontend en TypeScript (React, Vite, React Router, con Vitest y Testing Library como herramientas de prueba), Drizzle ORM, PostgreSQL y JWT. La enmienda va en un commit dedicado que explica el cambio, como la propia constitución exige, y deja intactos los demás principios.
- RF-35: EL SISTEMA hace que toda la documentación coincida con esa realidad: `docs/diseno-gestor-turnos.md` §5 (árbol de carpetas con `schema.js` y `drizzle.config.js`, y las carpetas `docs/specs`, `.github`, `frontend/src/components`), su lista de pendientes (pagos y disponibilidad ya implementados; notificaciones y adjuntos pendientes) y las descripciones de stack del README. Tras la enmienda, ningún documento del repositorio afirma que el backend esté en TypeScript.

## Requisitos no funcionales

- Ningún secreto real en el repositorio ni en la imagen; los valores de ejemplo (incluida la contraseña de los usuarios demo) son evidentemente de desarrollo.
- El inicio rápido funciona en Linux y macOS con Docker Compose v2; Windows queda fuera de la verificación (se usa WSL).
- El workflow de CI completo tarda menos de 10 minutos.
- Idioma del README, mensajes del seed y documentación: español. Los nombres de scripts, variables y rutas no se traducen.

## Notas de arquitectura

- El seed vive en `backend/db/seed.js`, junto a `migrate.js`, y exporta una función `seedDemo(db, { now })` que el script de línea de comandos invoca; así se prueba contra una base real sin ejecutar un proceso aparte. Sigue la forma de los casos de uso (recibe `db` y `repos`).
- Aplicar migraciones en Docker no requiere dependencias nuevas: `db/migrate.js` ya existe y solo usa dependencias de producción; se ejecuta como servicio de un solo uso o como paso previo del arranque.
- `GET /health` va fuera de `/public` y sin limitador (lo consulta el orquestador con frecuencia).
- El test del README (RF-10) vive en el backend (`tests/docs/readme.test.js`) porque es el que ya tiene runner; lee el README y los dos `package.json` con `fs`, sin dependencias.
- Dependencias nuevas: ninguna en las aplicaciones. La imagen del frontend usa `nginx` (imagen oficial `nginx:alpine`) como servidor estático y proxy: infraestructura nueva que, por el principio 1 de la constitución, se justifica acá — sirve los archivos construidos con fallback a `index.html` para las rutas del navegador y reenvía `/api` al backend; el servidor de `vite preview` no está pensado para producción y no incluye ese proxy configurable.
- El servicio `setup` reutiliza la imagen del backend con otro comando (`node db/migrate.js && node db/seed.js --if-missing`); no hay imagen ni dependencia nuevas. El seed y la migración se ejecutan antes de que el backend acepte tráfico, por lo que el primer arranque entrega la demo ya poblada.
- El identificador fijo de la cuenta demo (RF-19) es un UUID de la forma de `gen_random_uuid()`; no puede colisionar con cuentas reales y permite que el README y el humo de CI usen una URL estable.

## Casos límite

- `.env` ausente al ejecutar `docker compose up` → Compose falla por variables vacías; el README lo prevé en el paso 2 (`cp .env.example .env`).
- `SEED_DEMO=false` → se migra pero no se siembra; la aplicación arranca vacía (se registra un owner nuevo desde la pantalla de acceso).
- Reiniciar con `docker compose up` una cuenta demo ya sembrada → no se recrea ni se pierden los cambios hechos durante la prueba (RF-22); para volver al estado inicial, `docker compose exec backend npm run db:seed` (recrea) o `down -v`.
- Ruta del navegador abierta directamente (`/reservar/<id>`, recargar en `/turno/<id>?token=…`) → el servidor del frontend devuelve la aplicación y no 404 (RF-17).
- Puertos 3000, 5173 o 5432 ocupados → el README indica cómo cambiarlos por variable.
- Seed ejecutado dos veces seguidas → una sola cuenta demo, con fechas nuevas (RF-21).
- Seed que falla a mitad (por ejemplo, un solapamiento inesperado) → la cuenta demo anterior sigue intacta (RF-23).
- Seed ejecutado un domingo o con `now` cercano a medianoche → los turnos futuros siguen cayendo en días hábiles y no antes de `now` (RF-28).
- `docker compose down -v` → borra la base; el siguiente `up` vuelve a migrar y a sembrar la demo, sin pasos extra.
- Migración que falla al levantar Docker → el backend no arranca y `docker compose logs` muestra el motivo (RF-13).
- Pull request desde un fork → la CI no necesita secretos, por lo que corre igual (RF-29).
- Un script citado en el README que se renombra → el test de RF-10 falla en la CI antes de que el README quede desactualizado.

## Fuera de alcance

- Despliegue a un servicio en la nube, HTTPS, dominio propio y reverse proxy de producción.
- Automatizaciones de mantenimiento (Dependabot, releases, changelog) y métricas de cobertura.
- Linter o formateador para el backend; OpenAPI/Swagger; logging estructurado; `helmet`/CORS; validación con esquemas.
- Implementar los pendientes que el README lista como roadmap (notificaciones, zonas horarias, pantallas del panel, activación de trabajadores, recuperación de contraseña).
- Datos demo en inglés o internacionalización.
- Verificación del inicio rápido en Windows nativo.
- Capturas de pantalla del README (quedan como pendiente declarado en el propio README, RF-6; se sumarán cuando la interfaz esté estable).
- Elegir una licencia y agregar `LICENSE`: el repositorio queda sin licencia por decisión explícita, y el README lo dice (RF-6). Los `package.json` conservan su campo `license` actual.

## Criterios de finalización

- Cada RF con verificación automatizada, salvo los de redacción del README (RF-1 a RF-9), que se verifican con RF-10 y revisión. Se priorizan los casos no obvios:
  1. El seed es idempotente y atómico: dos ejecuciones dejan una sola cuenta demo; un fallo forzado a mitad conserva la cuenta anterior (RF-21, RF-23).
  2. El seed no se ejecuta en producción y no escribe nada (RF-24).
  3. Los datos del seed respetan las reglas reales: ningún solapamiento, pagos con comisión correcta, turnos futuros dentro de disponibilidad (RF-19, RF-20, RF-28).
  4. `GET /health` responde 503 con la base caída (RF-15).
  5. El test del README detecta un script inexistente, una variable sin documentar y un enlace roto (RF-10).
  6. La CI corre en UTC y en `America/Santiago` (RF-30) y el humo reproduce el inicio rápido (RF-32).
- `npm test` y `npm run db:migrate` del backend, y `npm test`, `npm run lint` y `npm run build` del frontend, en verde.
- Demo manual: en un directorio vacío, seguir el README al pie de la letra (clonar, `cp .env.example .env`, `docker compose up`) y llegar a la agenda del owner y a la reserva pública en menos de 5 minutos, sin ejecutar ningún otro comando ni consultar nada más.

## Dudas abiertas

- Ninguna. Q1 a Q4 de la primera redacción están resueltas; ver D9 a D12.

## Registro de decisiones

- **D1** — El README se verifica con un test (RF-10): la documentación desactualizada es el defecto más común de un repo de portafolio y es barato de detectar.
- **D2** — El seed usa los casos de uso y no `INSERT` directos (RF-20): un seed con inserts a mano puede crear datos que la aplicación jamás permitiría (solapamientos, pagos sin comisión) y esconder defectos.
- **D3** — El seed borra y recrea la cuenta demo en lugar de "agregar si falta" (RF-21): los turnos tienen fechas relativas a hoy, así que un dato viejo queda pasado y el demo pierde sentido.
- **D4** — `GET /health` consulta la base (RF-15): un `200` fijo diría que el proceso vive aunque no pueda atender nada, y es justo lo que el orquestador y el humo de CI necesitan distinguir.
- **D5** — Un job de humo con `docker compose up --wait` (RF-32): es la única forma de que el inicio rápido del README esté probado en cada cambio y no solo cuando alguien lo recuerda.
- **D6** — La CI del backend corre en dos zonas horarias (RF-30): los slots dependen de la hora local del servidor y es la limitación más probable de romper en otra máquina; ya se verificó que la suite actual pasa en UTC, Buenos Aires y Tokio.
- **D7** — `TZ` configurable con valor por defecto de Santiago de Chile (RF-18): el producto está pensado para la hora local de Chile y hasta que haya zonas por negocio es la forma honesta de fijarla. Chile tiene horario de verano (Buenos Aires no): la suite se verificó también en `America/Santiago`, y el formato de fechas de la interfaz sigue siendo `es-AR` (spec 005 RF-35).
- **D8** — Compose deriva `DATABASE_URL` de las variables de Postgres (RF-12): tener la misma información escrita en dos lugares ya produjo un `.env.example` vacío e inconsistente.
- **D9** — (Q1) El frontend entra en `docker-compose.yml` (RF-17) para que un único `docker compose up` entregue el sistema completo; se paga con un `Dockerfile` multi-etapa y `nginx`. A cambio, el humo de CI prueba el camino real que usará el revisor, incluido el proxy `/api`.
- **D10** — (Q2) Se enmienda la constitución en lugar de migrar el backend a TypeScript (RF-34, RF-35): la migración es una spec aparte y mucho mayor, y hoy el backend funciona y está probado. La enmienda alinea la regla con la realidad y la deja registrada en un commit propio.
- **D11** — (Q3) Las capturas de pantalla quedan pendientes y declaradas como tal en el README, en lugar de sumarse ahora: la interfaz todavía cambia y una imagen desactualizada es peor que ninguna.
- **D12** — (Q4) Sin licencia por ahora, declarado en el README (RF-6): evita elegirla sin criterio, y que sea explícito impide que se lea como un olvido.
- **D13** — El seed siembra con `--if-missing` desde Docker (RF-13, RF-22) pero recrea por defecto desde la línea de comandos (RF-21): el arranque no debe pisar el estado de una demo en uso, y quien ejecuta el seed a mano pide justamente un estado limpio.
- **D14** — La cuenta demo tiene un UUID fijo (RF-19): permite documentar y probar en CI una URL de reserva estable sin leer los logs del contenedor.
