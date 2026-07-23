-- ============ Esquema de base de datos — Querify Analytics ============

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

-- Timeline de mensajes (enviados, fallidos, simulados y entrantes)
CREATE TABLE IF NOT EXISTS mensajes (
  id            SERIAL PRIMARY KEY,
  prospecto_id  INT NOT NULL REFERENCES prospectos(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,   -- 'bienvenida'|'recordatorio'|'valor'|'cierre'|'entrante'|'sistema'
  canal         TEXT NOT NULL,   -- 'whatsapp'|'correo'|'sistema'
  estado        TEXT NOT NULL,   -- 'enviado'|'fallido'|'simulado'|'recibido'|'nota'
  contenido     TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensajes_prospecto ON mensajes (prospecto_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_estado    ON mensajes (estado);

-- Próxima fecha de inicio por curso + modalidad (8 filas). La edita el operador.
CREATE TABLE IF NOT EXISTS fechas_inicio (
  id         SERIAL PRIMARY KEY,
  curso      TEXT NOT NULL,       -- 'Excel'|'SQL Server'|'Power BI'|'Python'
  modalidad  TEXT NOT NULL,       -- 'entre_semana'|'sabatino'
  fecha      DATE,
  UNIQUE (curso, modalidad)
);
