# Gestor de turnos para profesionales independientes — Documento de diseño

Documento vivo con las decisiones tomadas hasta ahora. Sirve como referencia antes de escribir la migración y el código, y también como material para el README del repo (justificación de decisiones técnicas).

---

## 1. Modelo de datos

### Tablas base

**accounts** (el negocio/tenant)
- `id` PK
- `business_name`
- `created_at`

**users** (login: dueño o empleados)
- `id` PK
- `account_id` FK → accounts
- `name`, `email`, `password_hash`
- `role` (`owner` | `staff`)

**clients** (contactos, sin login)
- `id` PK
- `account_id` FK
- `name`, `notes`
- `email` (opcional individualmente; `UNIQUE` sobre `lower(email)`, normalizado a minúsculas antes de guardar)
- `phone` (opcional individualmente; `UNIQUE`, normalizado a formato E.164 antes de guardar)
- `CHECK`: al menos uno de `email`/`phone` debe existir (mismo patrón de nulabilidad condicional que en `appointments`)

**appointment_access_tokens** (tabla nueva — tokens de acceso sin login para clientes)
- `id` PK
- `appointment_id` FK → appointments
- `token_hash` (hash SHA-256 del token — no bcrypt, ya que el token nace con alta entropía y no necesita ralentización artificial)
- `expires_at` (vencimiento atado al horario del turno, no a un plazo fijo — asegura que cancelar/reprogramar se haga con anticipación razonable)
- `created_at`

**services**
- `id` PK
- `account_id` FK
- `name`
- `duration_minutes`
- `price` (precio **actual**, lectura rápida — se mantiene aunque exista historial, por ser la consulta más frecuente del sistema)
- `active` (boolean — baja lógica, ver sección 3.4)

**service_price_history** (tabla nueva)
- `id` PK
- `service_id` FK → services
- `price`
- `changed_at` (incluye el precio de nacimiento del servicio, no solo cambios posteriores)

**appointments** (recurso central)
- `id` PK
- `account_id` FK (denormalizado a propósito — evita joins extra en queries frecuentes de disponibilidad/listado)
- `client_id` FK → clients (nullable solo si `status = 'bloqueado'`)
- `service_id` FK → services (nullable solo si `status = 'bloqueado'`)
- `assigned_user_id` FK → users (nullable solo si `status = 'bloqueado'`; en ese caso, `NULL` significa "bloqueo de todo el negocio", no vacío por error)
- `scheduled_at` (inicio)
- `scheduled_until` (fin — siempre obligatorio, incluso en bloqueos; calculado desde `scheduled_at + services.duration_minutes` en reservas normales, definido directamente por quien bloquea en el caso de bloqueos)
- `status` (ver máquina de estados, sección 3.1)
- `notes`
- `created_at`

**payments**, **notifications**, **attachments**, **availability** — definidas en el ERD inicial, sin cambios respecto al diseño original.

---

## 2. Diagrama ERD (mermaid)

```
erDiagram
  ACCOUNTS ||--o{ USERS : employs
  ACCOUNTS ||--o{ CLIENTS : has
  ACCOUNTS ||--o{ SERVICES : offers
  ACCOUNTS ||--o{ APPOINTMENTS : owns
  CLIENTS ||--o{ APPOINTMENTS : books
  SERVICES ||--o{ APPOINTMENTS : defines
  SERVICES ||--o{ SERVICE_PRICE_HISTORY : has
  APPOINTMENTS ||--o{ APPOINTMENT_ACCESS_TOKENS : has
  USERS ||--o{ APPOINTMENTS : assigned_to
  USERS ||--o{ AVAILABILITY : defines
  APPOINTMENTS ||--o| PAYMENTS : has
  APPOINTMENTS ||--o{ NOTIFICATIONS : triggers
  APPOINTMENTS ||--o{ ATTACHMENTS : has
  CLIENTS ||--o{ ATTACHMENTS : has
```

---

## 3. Reglas de negocio

### 3.1 Máquina de estados de `appointments`

Estados posibles: `bloqueado`, `agendado`, `en_progreso`, `completado`, `no_llego`, `cancelado`.

- `bloqueado` — fila creada directamente por admin/profesional, sin cliente ni servicio. No pasa por ningún otro estado (se libera con una acción específica, no se "reprograma").
- `agendado → en_progreso → completado` — transiciones **automáticas por tiempo** (comparando reloj actual contra `scheduled_at`/`scheduled_until`, vía proceso tipo `node-cron`). Ningún endpoint las dispara manualmente.
- `en_progreso → no_llego` — el profesional marca manualmente que el cliente no llegó.
- `completado ↔ no_llego` — corrección manual posterior, por si el profesional se olvidó de marcarlo durante el turno.
- `agendado → cancelado` — el cliente o el profesional cancelan un turno ya reservado. **La fila se preserva** (no se borra), para no perder historial ni métricas (% de cancelación, etc.) ni romper el envío de notificaciones asociadas.

### 3.2 Regla de nulabilidad condicional (CHECK constraint)

```sql
(status = 'bloqueado' AND client_id IS NULL AND service_id IS NULL)
OR
(status != 'bloqueado' AND client_id IS NOT NULL AND service_id IS NOT NULL AND assigned_user_id IS NOT NULL)
```

`assigned_user_id` puede ser `NULL` o no dentro de `bloqueado` (según si el bloqueo es de un empleado específico o de todo el negocio) — no necesita cláusula propia, agregar una sería tautológica.

### 3.3 Prevención de solapamiento de horarios (concurrencia)

Un `EXCLUSION CONSTRAINT` declarativo no alcanza porque la regla necesita un `OR` explícito para el caso de bloqueos de negocio (`assigned_user_id IS NULL` no es "igual" a nada, ni siquiera a otro `NULL`, bajo SQL estándar). Se resuelve con un **trigger `BEFORE INSERT OR UPDATE`** que corre esta verificación:

```sql
SELECT 1 FROM appointments
WHERE account_id = NEW.account_id
  AND status != 'cancelado'
  AND id != NEW.id
  AND (
    assigned_user_id = NEW.assigned_user_id
    OR assigned_user_id IS NULL
    OR NEW.assigned_user_id IS NULL
  )
  AND scheduled_at < NEW.scheduled_until
  AND NEW.scheduled_at < scheduled_until
```

Si esta consulta devuelve alguna fila, se rechaza el `INSERT`/`UPDATE`.

### 3.4 Snapshot de precios (`service_price_history`)

Cambiar `services.price` no debe afectar reservas ya creadas con el precio anterior. Se resuelve guardando el historial completo (incluyendo el precio de nacimiento) en una tabla dedicada, no en una columna JSON — una tabla permite indexar y filtrar por fecha/negocio de forma nativa, y no paga el costo creciente de reescribir un blob completo en cada cambio.

Cambiar el precio implica dos operaciones que deben ejecutarse en una **transacción** (`UPDATE services.price` + `INSERT` en `service_price_history`), nunca solo una de las dos.

### 3.5 Baja lógica de servicios

Igual criterio que `cancelado`: un servicio con turnos históricos asociados no puede borrarse físicamente (rompería la FK y perdería historial de reportes). Se reutiliza la columna `active` (ya definida en el modelo original) para marcar baja lógica; las queries de "servicios disponibles para reservar" simplemente filtran `active = true`.

### 3.6 Reprogramación

Se implementa como **cancelar la fila vieja + crear una fila nueva**, dentro de una transacción (todo o nada) — no como dos llamadas separadas del cliente a la API. Reutiliza la misma lógica de creación (incluida la auto-asignación de profesional si corresponde), evitando duplicar código.

### 3.7 Auto-asignación de profesional

Si el cliente no elige un profesional específico, el sistema auto-asigna uno disponible en el momento de crear la reserva (no se deja el turno "flotando" sin asignar, para evitar que el cliente llegue y tenga que esperar). `assigned_user_id` solo queda `NULL` en el caso de un bloqueo de negocio completo — en cualquier otro caso, siempre tiene un valor.

### 3.8 Prevención de clientes duplicados

`clients` no tiene login, así que no hay contraseña que fuerce unicidad de forma natural. Se resuelve con `UNIQUE` sobre `email` (normalizado a minúsculas) y sobre `phone` (normalizado a formato E.164) — normalizar *antes* de guardar es necesario porque el mismo número/mail puede escribirse de formas distintas (`+56912345678` vs `912345678`) y la constraint compara valores byte a byte. Ambos campos son individualmente opcionales (un turista sin RUT/email podría reservar solo con teléfono), pero un `CHECK` exige que exista al menos uno de los dos.

### 3.9 Acceso sin login para clientes (tokens de un solo turno)

Un cliente recibe un link (por WhatsApp/email) para cancelar o reprogramar su turno sin necesitar cuenta ni contraseña. La seguridad no depende de que el cliente recuerde/tipee un dato (fricción de UX + vulnerable a fuerza bruta si el `id` del turno es predecible) sino de que el link mismo contenga un token aleatorio de alta entropía (`crypto.randomBytes`, no un hash derivado de datos conocidos — un hash de `appointment_id` sería adivinable). Se guarda en base de datos el hash del token (SHA-256, no bcrypt — el token ya nace con entropía suficiente y no necesita ralentización artificial), nunca el token en texto plano, para que un acceso no autorizado a la base de datos no habilite tomar control de turnos ajenos. El token vive en tabla propia (no en una columna de `appointments`) para poder loguear múltiples tokens emitidos por turno (reenvíos) e invalidar los anteriores. Vence en función de la cercanía al turno (no un plazo fijo), para asegurar que cancelar/reprogramar se haga con anticipación razonable.

Todas las rutas que aceptan este mecanismo (sin JWT) se agrupan bajo el prefijo `/public/...`, para poder aplicarles de forma centralizada un middleware de seguridad reforzado (rate-limiting estricto) a todo el grupo, en vez de por ruta individual.

### 3.10 Autorización por rol (`owner` vs `staff`)

- **Nunca confiar en datos que el cliente controla** (query string, body) para decisiones de autorización — siempre derivarlas del payload del JWT, que el backend firmó y solo el backend puede validar. Aplica a `employee_id` en filtros de lectura y a `assigned_user_id` en bloqueos de escritura.
- **Lecturas (listas):** si quien pregunta es `staff`, el backend ignora en silencio cualquier `employee_id` ajeno en la query string y fuerza el filtro al id del JWT — sin error explícito, ya que no hay daño real en simplemente devolver menos de lo pedido.
- **Escrituras:** si un `staff` intenta una acción fuera de su alcance (ej. `POST /appointments/block` con `assigned_user_id: null`, exclusivo de `owner`), el backend **rechaza** con error explícito — a diferencia de la lectura, corregir en silencio una escritura generaría confusión real sobre qué quedó guardado.
- **Acceso a un recurso puntual fuera de alcance** (`GET /appointments/:id` de otro empleado, o de otro negocio/tenant): responde **404**, nunca 403 — evita confirmar la existencia de un recurso ajeno (fuga de información menor entre compañeros, fuga grave entre tenants distintos).
- **403 sí aplica** cuando el recurso está dentro del alcance correcto (mismo negocio) pero la acción puntual está vedada por rol — ahí no hay nada que ocultar sobre la existencia del recurso, solo que la acción no está permitida.

Diferencias funcionales `owner` vs `staff`:

| Acción | Owner | Staff |
|---|---|---|
| Ver turnos | Todos los del negocio | Solo los propios |
| Editar servicios (nombre, duración, precio) | Sí | No |
| Bloquear turnos/días | Propios, de cualquier empleado, o negocio completo | Solo los propios |
| Resumen financiero | Sí | No |

---

## 4. Especificación REST

### Recurso `appointments`

| Método | Ruta | Descripción | Quién |
|---|---|---|---|
| GET | `/appointments?type=&employee_id=&date_from=&date_to=&status=` | Listar con filtros combinables | admin/profesional |
| GET | `/appointments/:id` | Detalle de un turno puntual | cliente dueño / admin / profesional asignado |
| POST | `/appointments` | Crear una reserva | cliente |
| POST | `/appointments/block` | Crear un bloqueo | admin/profesional (requiere auth) |
| PATCH | `/appointments/:id/cancel` | Cancelar turno de cliente (preserva la fila) | profesional/admin, con JWT |
| PATCH | `/public/appointments/:id/cancel?token=` | Cancelar turno, sin login | cliente, vía token de acceso |
| PATCH | `/appointments/:id/cancel-block` | Liberar un bloqueo | admin/profesional |
| PATCH | `/public/appointments/:id/reschedule?token=` | Reprogramar (transacción: cancela vieja + crea nueva), sin login | cliente, vía token de acceso |
| PATCH | `/appointments/:id/correct` | Corregir `completado` ↔ `no_llego` | profesional |

*Nota: cancelar/reprogramar por parte del cliente usa el prefijo `/public` (autenticación por token, no JWT); las acciones de profesional/admin usan JWT tradicional. Mismo recurso, dos mecanismos de auth distintos → dos rutas separadas.*

### Recurso `availability`

| Método | Ruta | Descripción | Quién |
|---|---|---|---|
| GET | `/availability/:business_id?employee_id=&service_id=&date_from=&date_to=` | Horarios libres calculados (no son filas reales — se derivan de `availability` + `services.duration_minutes` − `appointments` ocupados). Solo ofrece trabajadores (`staff`) `activo`s | público |
| GET | `/staff/:id/availability` | Horario semanal del trabajador (ventanas `day_of_week`, `start_time`, `end_time` en `HH:MM`) | owner (cualquier trabajador) / staff (solo el propio) |
| PUT | `/staff/:id/availability` | Reemplaza el horario completo en una transacción (`[]` lo vacía). Valida forma (400), valores y solapamiento (422); trabajador `inactivo` → 422 | owner / staff (solo el propio) |

*Spec 004. Fuera de alcance o ajeno → 404 (incluido el id de un owner: no atiende turnos, no tiene horario). El no-solapamiento de ventanas lo garantiza un `EXCLUDE` en la base (migración 0006). Cambiar el horario no toca turnos ya agendados.*

*Pendiente de decisión de producto: si `service_id` es obligatorio u opcional (afecta si se devuelven bloques ya cortados por duración, o un rango libre sin cortar).*

### Recurso `services`

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/services` | Crear (recibe `business_id` en el body) |
| GET | `/services?business_id=&active=` | Listar con filtros |
| GET | `/services/:id` | Detalle de un servicio puntual |
| PATCH | `/services/:id` | Editar nombre/duración (no toca historial) |
| PATCH | `/services/:id/prices` | Cambiar precio (transacción con `service_price_history`) |
| PATCH | `/services/:id/deactivate` | Baja lógica (`active = false`) |

---

### Recurso `clients`

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/clients` | Crear (recibe `business_id` en el body; valida unicidad normalizada de email/phone) |
| GET | `/clients?business_id=` | Listar |
| GET | `/clients/:id` | Detalle |
| PATCH | `/clients/:id` | Editar datos de contacto |

*Pendiente: endpoint de "fusionar clientes duplicados" para los casos que la unicidad normalizada no capture (ej. mismo email con dominios distintos por error de tipeo).*

---

## 5. Setup técnico

- **ORM:** Drizzle, no Sequelize — el proyecto depende de lógica que vive en la base de datos (trigger de solapamiento, `CHECK` condicional, índice único funcional sobre `lower(email)`), y las migraciones `.sql` reales de Drizzle permiten escribir esa lógica en el mismo archivo/lenguaje, sin mezclar SQL crudo dentro de wrappers JS como exigiría Sequelize.
- **Monorepo:** frontend y backend en el mismo repositorio — al ser desarrollo individual, la sincronización entre ambos lados pesa más que el orden que dan los repos separados (relevante sobre todo con equipos grandes, no es el caso acá).
- **Arquitectura backend:** clean architecture (domain / application / infrastructure), reusando el patrón ya aplicado en `my-finances`/`my-tasks`. Reglas de negocio puras (máquina de estados, nulabilidad condicional) en `domain`; orquestación de casos de uso (ej. reprogramar = verificar disponibilidad + auto-asignar + transacción) en `application`; detalle técnico (Express, Drizzle, S3, Twilio) en `infrastructure`.
- **Migraciones:** carpeta `db/` separada, hermana de `src/` — `drizzle-kit` necesita ejecutarlas sin levantar la aplicación completa.

```
gestor-turnos/
├── backend/
│   ├── src/
│   │   ├── domain/
│   │   ├── application/
│   │   └── infrastructure/
│   │       ├── http/
│   │       ├── db/
│   │       └── integrations/
│   ├── db/
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── tests/
│   ├── drizzle.config.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── domain/
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/
│   └── package.json
├── docs/
│   └── diseno-gestor-turnos.md
├── docker-compose.yml
└── README.md
```

## 6. Pendiente

- **`payments`, `notifications`, `attachments`**: definidos en el ERD inicial, sin especificación de endpoints todavía.
- Implementación de JWT (middleware, expiración, refresh tokens) — el diseño de *qué* autoriza cada rol ya está resuelto; falta el detalle de implementación del propio JWT en sí (esto es más convención que decisión de diseño, y AlojaFacil ya tiene el patrón resuelto para reutilizar).