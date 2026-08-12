-- ============ Esquema de base de datos — Querify Analytics ============
-- Sin herramienta de migraciones: este archivo se corre completo en cada
-- arranque (initDb() en server.js). Las tablas usan CREATE TABLE IF NOT
-- EXISTS; los ALTER puntuales de abajo cubren cambios de columna en bases
-- ya creadas por una versión anterior de este archivo (no hay datos de
-- producción todavía — el proyecto sigue en fase local, ver ESTADO.md).

CREATE TABLE IF NOT EXISTS prospectos (
  id                        SERIAL PRIMARY KEY,
  nombre                    TEXT        NOT NULL,
  curso                     TEXT        NOT NULL DEFAULT 'Aún no decido',
  telefono_pais             TEXT,                 -- ej. '+52'
  telefono                  TEXT,                 -- solo dígitos
  correo                    TEXT,
  canal                     TEXT        NOT NULL DEFAULT 'whatsapp', -- 'whatsapp' | 'correo'
  estado_secuencia          TEXT        NOT NULL DEFAULT 'activa',   -- 'activa' | 'finalizada'
  paso_actual               INT         NOT NULL DEFAULT 0,          -- 0 bienvenida .. 3 cierre
  origen                    TEXT        NOT NULL DEFAULT 'sitio_web',
  fecha_registro            TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_inicio_secuencia    TIMESTAMPTZ NOT NULL DEFAULT now(),      -- ancla de agenda (se reinicia si vuelve frío)
  fecha_ultimo_mensaje      TIMESTAMPTZ,
  fecha_ultimo_entrante     TIMESTAMPTZ,
  notas                     TEXT
);
CREATE INDEX IF NOT EXISTS idx_prospectos_tel    ON prospectos (telefono);
CREATE INDEX IF NOT EXISTS idx_prospectos_mail   ON prospectos (correo);
CREATE INDEX IF NOT EXISTS idx_prospectos_estado ON prospectos (estado_secuencia);

-- Cohortes: curso + modalidad + fecha de inicio, con cupo máximo (10 alumnos).
-- Reemplaza a la antigua tabla `fechas_inicio` (una sola fecha "próxima" por
-- curso×modalidad). Aquí puede haber varias filas por curso×modalidad a lo
-- largo del tiempo — una por generación — porque el cupo sí es transaccional
-- (se apartan lugares de verdad). engine.proximaFecha() lee de aquí la fecha
-- que se muestra en el mensaje de "valor" de la secuencia de seguimiento.
CREATE TABLE IF NOT EXISTS cohortes (
  id                SERIAL PRIMARY KEY,
  curso             TEXT NOT NULL,        -- 'Excel'|'SQL Server'|'Power BI'|'Python'
  modalidad         TEXT NOT NULL,        -- 'entre_semana'|'sabatino'
  fecha_inicio      DATE,                 -- NULL hasta que el operador la fije
  cupo_maximo       INT  NOT NULL DEFAULT 10,
  lugares_ocupados  INT  NOT NULL DEFAULT 0,
  UNIQUE (curso, modalidad, fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_cohortes_curso ON cohortes (curso);
CREATE INDEX IF NOT EXISTS idx_cohortes_fecha ON cohortes (fecha_inicio);
-- El UNIQUE de arriba no evita duplicados mientras fecha_inicio es NULL
-- (Postgres nunca considera iguales dos NULLs): este índice parcial evita
-- duplicar la fila "placeholder, sin fecha aún" del mismo curso+modalidad
-- (la usa seed.sql para que `npm run db:init` sea idempotente); no aplica
-- a las cohortes ya fechadas, esas se distinguen por su fecha_inicio.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cohortes_sin_fecha ON cohortes (curso, modalidad) WHERE fecha_inicio IS NULL;

-- Alumnos: se crea uno únicamente cuando se confirma el pago 1 (apartar
-- lugar) — no al iniciar el checkout de Stripe. El cupo de su cohorte se
-- ocupa en ese mismo momento (regla de negocio ya tomada, no reabrir).
CREATE TABLE IF NOT EXISTS alumnos (
  id             SERIAL PRIMARY KEY,
  prospecto_id   INT REFERENCES prospectos(id) ON DELETE SET NULL, -- NULL si no vino del formulario
  cohorte_id     INT NOT NULL REFERENCES cohortes(id),
  nombre         TEXT NOT NULL,
  whatsapp_pais  TEXT,                 -- ej. '+52' (mismo formato que prospectos.telefono_pais)
  whatsapp       TEXT,                 -- solo dígitos
  correo         TEXT,
  fecha_alta     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alumnos_cohorte   ON alumnos (cohorte_id);
CREATE INDEX IF NOT EXISTS idx_alumnos_prospecto ON alumnos (prospecto_id);

-- Pagos: 5 exhibiciones de $500 MXN por alumno (semanas 0/2/4/6/8 desde el
-- inicio de la cohorte). El pago 1 se crea ya 'pagado' al confirmar el
-- webhook de Stripe; los pagos 2-5 se crean 'pendiente' y el cron los cobra
-- cerca de su vencimiento (ver engine.revisarPagosPorVencer).
CREATE TABLE IF NOT EXISTS pagos (
  id                        SERIAL PRIMARY KEY,
  alumno_id                 INT NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  numero_pago                INT NOT NULL,                  -- 1..5
  monto                      NUMERIC(10,2) NOT NULL DEFAULT 500.00,
  fecha_vencimiento          DATE NOT NULL,
  estado                     TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente'|'pagado'|'vencido'
  metodo                     TEXT,                          -- 'stripe'|'manual'
  stripe_session_id          TEXT,
  stripe_payment_intent_id   TEXT,
  fecha_pago                 TIMESTAMPTZ,
  fecha_recordatorio_enviado TIMESTAMPTZ,                   -- throttle: no reenviar el link más de 1x/día
  UNIQUE (alumno_id, numero_pago)
);
CREATE INDEX IF NOT EXISTS idx_pagos_alumno ON pagos (alumno_id);
CREATE INDEX IF NOT EXISTS idx_pagos_estado ON pagos (estado);

-- Timeline de mensajes (enviados, fallidos, simulados y entrantes). Cada fila
-- pertenece a un prospecto (seguimiento) o a un alumno (recordatorios de
-- pago) — nunca a ambos.
CREATE TABLE IF NOT EXISTS mensajes (
  id            SERIAL PRIMARY KEY,
  prospecto_id  INT REFERENCES prospectos(id) ON DELETE CASCADE,
  alumno_id     INT REFERENCES alumnos(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,   -- 'bienvenida'|'recordatorio'|'valor'|'cierre'|'pago'|'entrante'|'sistema'
  canal         TEXT NOT NULL,   -- 'whatsapp'|'correo'|'sistema'
  estado        TEXT NOT NULL,   -- 'enviado'|'fallido'|'simulado'|'recibido'|'nota'
  contenido     TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migración en línea para bases locales creadas con la versión anterior de
-- este archivo (prospecto_id era NOT NULL; no existía alumno_id). Va ANTES
-- de los índices de abajo a propósito: en una base donde `mensajes` ya
-- existía, el CREATE TABLE de arriba es un no-op (no crea alumno_id), así
-- que el índice sobre esa columna fallaría si se creara primero.
ALTER TABLE mensajes ALTER COLUMN prospecto_id DROP NOT NULL;
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mensajes_prospecto ON mensajes (prospecto_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_alumno    ON mensajes (alumno_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_estado    ON mensajes (estado);

-- `fechas_inicio` queda reemplazada por `cohortes` (ver decisión en la
-- conversación de esta funcionalidad) — se elimina si existía de antes.
DROP TABLE IF EXISTS fechas_inicio;
