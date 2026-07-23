# Querify Analytics — Backend de captura y seguimiento

Backend en Node.js (Express + PostgreSQL) que recibe los prospectos del sitio, guarda cada uno, y corre la **secuencia automática de seguimiento por WhatsApp** (con correo de respaldo). Incluye un **panel de administración**.

Funciona **sin credenciales en modo simulación**: puedes probar todo el flujo en local (el prospecto se guarda, la bienvenida se "envía", el cron avanza la secuencia y el panel muestra el timeline) sin cuentas de Meta/SMTP/Graph. Cuando pongas las credenciales, empieza a enviar de verdad sin tocar código.

---

## Qué hace

- **`POST /api/leads`** — recibe el formulario, revisa el honeypot, valida del lado servidor, aplica la **regla de duplicados de 14 días**, guarda en PostgreSQL y responde al instante. En segundo plano dispara la **bienvenida** y sincroniza una copia a Excel/SharePoint.
- **Motor de secuencia (cron horario)** — a cada prospecto activo le manda: recordatorio a las **24 h**, mensaje de valor a las **72 h** (con la próxima fecha de inicio) y cierre suave a los **7 días**. Luego finaliza.
- **Webhook de WhatsApp** — si el prospecto responde por WhatsApp, la secuencia se **detiene automáticamente**.
- **Canal con respaldo** — WhatsApp principal; si no dejó WhatsApp, todo va por correo; si un WhatsApp falla y hay correo, se reintenta por correo.
- **Panel `/admin`** — lista con filtros, detalle con timeline y botones (marcar como respondió / pausar), sección de errores de envío y edición de fechas de inicio.

## Estructura

```
querify-backend/
├─ db/schema.sql        Tablas (prospectos, mensajes, fechas_inicio)
├─ db/seed.sql          Las 8 fechas de inicio (curso × modalidad)
├─ src/db.js            Config (.env) + conexión a Postgres + flags de simulación
├─ src/templates.js     Las 4 plantillas de mensajes (texto + params de Meta)
├─ src/providers.js     WhatsApp (Meta), correo (SMTP), sync (Graph) — con simulación
├─ src/engine.js        Canal, deduplicado, alta de prospecto y motor de secuencia
├─ src/routes.js        POST /api/leads  +  webhook de WhatsApp
├─ src/admin.js         Panel de administración
├─ src/server.js        Arranque (Express, cron, init de la base)
└─ scripts/             hash-password.js · db-init.js
```

---

## Correr en local (5 minutos, modo simulación)

Necesitas **Node 18+** y **PostgreSQL**. Si no tienes Postgres a la mano, lo más rápido es Docker:

```bash
docker run --name querify-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=querify -p 5432:5432 -d postgres:16
```

Luego:

```bash
cp .env.example .env
# En .env pon al menos:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/querify
#   STATIC_DIR=../querify-web   (para servir el sitio junto al backend)

npm install
npm start
```

Abre:
- Sitio: **http://localhost:3000**
- Panel: **http://localhost:3000/admin** — usuario `admin`, contraseña `querify` (fallback de demo; ver seguridad abajo).

Envía el formulario del sitio y aparecerá el prospecto en el panel, con la bienvenida "simulada" en su timeline (y en la consola del servidor).

### Probar la secuencia sin esperar horas

En `.env`, baja los umbrales y el cron para ver los mensajes en minutos:

```
SEQ_STEP1_HOURS=0.02
SEQ_STEP2_HOURS=0.04
SEQ_STEP3_HOURS=0.06
CRON_SCHEDULE=* * * * *
```

(Cada `0.02 h` ≈ 72 s. Con eso, en un par de minutos verás recordatorio → valor → cierre en el timeline.)

---

## Conectar el sitio (frontend)

Dos formas:

1. **Todo junto (más simple):** deja `STATIC_DIR=../querify-web`. El backend sirve el sitio, la API y el panel desde un solo servicio. En el sitio, deja `LEADS_ENDPOINT = "/api/leads"` en `assets/js/app.js`.
2. **Separado:** sitio en Netlify/Cloudflare + backend en Railway/Render. En `app.js` pon `LEADS_ENDPOINT = "https://tu-backend.up.railway.app/api/leads"` y agrega ese dominio del sitio a `CORS_ORIGINS` en el backend.

---

## Seguridad del panel

El fallback `admin` / `querify` **solo** funciona si `ADMIN_PASS_HASH` está vacío. Para producción, genera un hash real:

```bash
npm run hash -- "tu-contraseña-segura"
# copia la línea ADMIN_PASS_HASH=... en tu .env
```

---

## Poner los envíos en real

### WhatsApp (Meta Cloud API directa)
1. Crea una app en Meta for Developers y agrega el producto **WhatsApp**. Obtén el **Phone Number ID** y un **token**.
2. Da de alta las 4 **plantillas** (el contenido está en `src/templates.js`) en el idioma `es_MX`. Como mencionan precio/promoción, es probable que Meta las clasifique como **Marketing**.
3. En `.env`: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, y los nombres `TPL_*` que hayas usado.
4. Configura el **webhook** en Meta apuntando a `https://tu-backend/webhook`, con el `WHATSAPP_VERIFY_TOKEN` que pusiste, y suscríbete al campo `messages`.

> Nota MX: WhatsApp usa el formato internacional (lada país + número). El webhook empata por el sufijo del número, así que tolera el prefijo `1` histórico de México.

### Correo (respaldo)
Llena `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` con los datos de tu proveedor SMTP.

### Bitácora en Excel/SharePoint (opcional)
Registra una app en Entra ID con permisos de aplicación `Files.ReadWrite.All` (o `Sites.ReadWrite.All`), crea un `.xlsx` en SharePoint con una **tabla** llamada `Prospectos`, y llena `GRAPH_*` en `.env`. Si lo dejas vacío, esta sincronización simplemente se omite (no bloquea nada).

---

## Desplegar en Railway (recomendado para el cron)

1. Sube este repo a GitHub y crea un proyecto en Railway desde el repo.
2. Agrega el plugin **PostgreSQL** — Railway inyecta `DATABASE_URL` automáticamente.
3. Variables: copia las de `.env` (menos `DATABASE_URL`). Pon `NODE_ENV=production`.
4. Railway ejecuta `npm start`. Al arrancar, el backend crea las tablas solo.

**Railway vs Render:** el cron necesita que el servicio esté siempre activo. En Render, el plan gratuito de *Web Service* se suspende por inactividad y el cron no correría de forma fiable; usa un plan que no duerma o el **Cron Job** de Render por separado. En Railway no se suspende (pagas por uso).

---

## Variables de entorno

Todas están documentadas en **`.env.example`**. Lo que dejes vacío corre en modo simulación (WhatsApp/correo) u omitido (sync), sin romper el flujo.
