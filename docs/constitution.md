# Constitución — SaaS Gestor de Turnos

1. **Stack fijo.** Node + Express 5 + TypeScript, Drizzle ORM, PostgreSQL, JWT. Cambiar el stack o sumar una dependencia exige justificación escrita en la spec.
2. **Invariantes en la base.** Toda regla que deba cumplirse siempre vive en la DB (CHECK, trigger, índice único), no en la aplicación.
3. **Capas puras.** `domain/` sin I/O ni imports de infraestructura; `application/` orquesta casos de uso; `infrastructure/` es reemplazable.
4. **Atomicidad.** Cada operación multi-tabla (precio + historial, reprogramar, pago + comisión) ocurre en una sola transacción o no ocurre.
5. **Baja lógica.** Nunca `DELETE` físico en `services` ni `appointments`; usar `active = false` o `status = 'cancelado'`.
6. **Autorización.** La identidad sale del JWT, nunca del body o query. Recurso fuera de alcance → 404; 403 solo cuando el rol tiene vedada la acción.
7. **REST explícito.** Una acción con lógica propia tiene su ruta (`/cancel`, `/block`, `/correct`); no existe PATCH genérico con `status` libre.
8. **Migraciones inmutables.** Se generan con `drizzle-kit generate` y se revisan a mano; una migración ya aplicada nunca se edita.
9. **TDD.** Cada regla de negocio nueva empieza por un test que falla; los casos no obvios se priorizan sobre el CRUD. `npm test` y `npm run db:migrate` corren limpios antes de cada commit.
10. **SDD.** Cada feature arranca con una spec en `docs/specs/`; el plan precede al código; ante conflicto, esta constitución gana.
11. **YAGNI.** Es un proyecto de portafolio: se implementa lo que la spec pide, nada especulativo.
12. **Trazabilidad.** Commits en español que explican el porqué; una rama por spec.

_Enmiendas: se editan en un commit dedicado que explique el cambio._
