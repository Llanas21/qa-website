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
  lugares_ocupados  INT  NOT NULL DEFAULT 0
);
-- Días de clase del grupo (28 oct 2026): 'LM' | 'MJ' entre semana, 'SAB'
-- sabatino. Forman el nombre del grupo (EXCEL-LM-1126, ver
-- calendario.codigoGrupo) y permiten dos grupos del mismo curso entre
-- semana con la misma fecha, en días distintos. Default por curso para las
-- cohortes que ya existían: Excel/Python LM, SQL Server/Power BI MJ.
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS dias TEXT;
UPDATE cohortes SET dias = CASE WHEN modalidad = 'sabatino' THEN 'SAB'
  WHEN curso IN ('Excel', 'Python') THEN 'LM' ELSE 'MJ' END WHERE dias IS NULL;
-- Último día de clase. Por default 10 semanas (calendario.fechaFinPorDefecto),
-- editable en Cohortes porque los días festivos lo recorren.
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS fecha_fin DATE;
UPDATE cohortes SET fecha_fin = fecha_inicio + CASE WHEN dias = 'SAB' THEN 63 ELSE 65 END
  WHERE fecha_fin IS NULL AND fecha_inicio IS NOT NULL;
-- true = sus eventos del calendario de Outlook no están al día (cambió la
-- fecha, los días o la lista de recordatorios, o falló la última vez); el
-- cron los vuelve a intentar.
ALTER TABLE cohortes ADD COLUMN IF NOT EXISTS calendario_pendiente BOOLEAN NOT NULL DEFAULT true;
-- Antes era UNIQUE (curso, modalidad, fecha_inicio); ahora incluye los días.
ALTER TABLE cohortes DROP CONSTRAINT IF EXISTS cohortes_curso_modalidad_fecha_inicio_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cohortes_grupo ON cohortes (curso, modalidad, dias, fecha_inicio);
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
  archivado      BOOLEAN NOT NULL DEFAULT false, -- true = no recibe recordatorios de pago automáticos
  fecha_alta     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Migración en línea para bases creadas antes de que existiera `archivado`:
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS archivado BOOLEAN NOT NULL DEFAULT false;
-- Baja (dejó el curso, ver engine.darDeBaja): reemplaza al botón "Archivar"
-- desde el 20 oct 2026. `archivado` se conserva para los alumnos que ya lo
-- tenían (lote histórico), pero ya no se activa desde el panel.
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS fecha_baja TIMESTAMPTZ;
-- CLABE fija por alumno para pagar por transferencia SPEI (ver
-- engine.generarClabe/procesarTransferencia): un Customer de Stripe con
-- instrucciones de transferencia. Lo que llega ahí cubre solo sus pagos.
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS clabe TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS clabe_banco TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS clabe_titular TEXT;
-- Certificado de finalización: el PDF se guarda directo en la base (no hay
-- almacenamiento de archivos persistente en el contenedor de Railway — se
-- pierde en cada deploy) y se sirve público por un token aleatorio, no por
-- el id del alumno, para que la liga no sea adivinable.
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS certificado_pdf BYTEA;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS certificado_nombre TEXT;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS certificado_token TEXT UNIQUE;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS certificado_subido_en TIMESTAMPTZ;
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
  estado                     TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente'|'pagado'|'vencido'|'cancelado' (baja)
  metodo                     TEXT,                          -- 'stripe'|'transferencia'|'manual'
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

-- Recordatorios del calendario (28 oct 2026): una sola lista para todos los
-- cursos, editable en /admin/recordatorios. Cada uno se vuelve un evento de
-- Outlook por grupo (ver calendario.js). `dia_desde`/`dia_hasta` cuentan
-- desde la `ancla`: 'inicio' (día 0 = primera clase, negativos = antes) o
-- 'fin' (día 0 = última clase). `dia_hasta` NULL = un solo día.
CREATE TABLE IF NOT EXISTS recordatorios (
  id         SERIAL PRIMARY KEY,
  titulo     TEXT NOT NULL,
  ancla      TEXT NOT NULL DEFAULT 'inicio',
  dia_desde  INT  NOT NULL,
  dia_hasta  INT,
  notas      TEXT,
  orden      INT  NOT NULL DEFAULT 0
);
-- Lista inicial: el borrador de procesos del usuario (planeación de 28 días,
-- 2 días antes, durante y al finalizar). Solo si la tabla está vacía.
INSERT INTO recordatorios (orden, ancla, dia_desde, dia_hasta, titulo, notas)
SELECT * FROM (VALUES
  (1,  'inicio', -28, -22, 'Realizar encarpetado para nuevo curso (OneDrive)', NULL),
  (2,  'inicio', -28, -22, 'Grabar y editar video publicitario', NULL),
  (3,  'inicio', -28, NULL, 'Actualizar información en el sitio web', NULL),
  (4,  'inicio', -28, -25, 'Elaborar la planeación de campaña de 21 días alineada al presupuesto', NULL),
  (5,  'inicio', -24, -22, 'Elaborar flyers publicitarios', NULL),
  (6,  'inicio', -24, -22, 'Elaborar nuevas plantillas de mensajes', NULL),
  (7,  'inicio', -21, NULL, 'Aplicar campaña(s) publicitaria(s)', 'La campaña corre 21 días, hasta un día antes del inicio.'),
  (8,  'inicio', -21, -17, 'Pegar flyers publicitarios físicos', NULL),
  (9,  'inicio', -11, NULL, 'Realizar primer seguimiento (Plantilla Seguimiento 1)', NULL),
  (10, 'inicio', -4,  NULL, 'Realizar segundo seguimiento (Plantilla Seguimiento 2)', NULL),
  (11, 'inicio', -2,  NULL, 'Contactar a los alumnos', 'Pedirles nombre completo y correo para Microsoft Teams, y darles los materiales necesarios para el primer día.'),
  (12, 'inicio', -1,  NULL, 'Crear nuevo canal en el equipo de Teams', 'Usar la nomenclatura del grupo.'),
  (13, 'inicio', -1,  NULL, 'Crear encarpetado en SharePoint y subir el material', NULL),
  (14, 'inicio', 0,   NULL, 'Aplicar examen de diagnóstico', NULL),
  (15, 'fin',    0,   NULL, 'Aplicar evaluación general', NULL),
  (16, 'fin',    1,   NULL, 'Enviar certificados de finalización', NULL)
) AS v(orden, ancla, dia_desde, dia_hasta, titulo, notas)
WHERE NOT EXISTS (SELECT 1 FROM recordatorios);

-- Evento de Outlook creado por grupo × recordatorio × buzón, para poder
-- moverlo o borrarlo después. `firma` = hash del contenido enviado: si no
-- cambió, no se vuelve a mandar. Sin FK a recordatorios a propósito: al
-- borrar un recordatorio hay que borrar primero su evento en Outlook.
CREATE TABLE IF NOT EXISTS cohorte_eventos (
  id               SERIAL PRIMARY KEY,
  cohorte_id       INT  NOT NULL REFERENCES cohortes(id) ON DELETE CASCADE,
  recordatorio_id  INT  NOT NULL,
  buzon            TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  firma            TEXT,
  UNIQUE (cohorte_id, recordatorio_id, buzon)
);

-- `fechas_inicio` queda reemplazada por `cohortes` (ver decisión en la
-- conversación de esta funcionalidad) — se elimina si existía de antes.
DROP TABLE IF EXISTS fechas_inicio;
