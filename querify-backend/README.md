# Querify Analytics — Backend

Backend en Node.js (Express + PostgreSQL) de la academia: inscripción con pago real (Stripe, con tarjeta o transferencia SPEI), plan de 5 pagos por alumno con cobro automático de los pagos 2-5, certificados en PDF, recordatorios de cada grupo en el calendario de Outlook y un **panel de administración** (`/admin`).

Funciona **sin credenciales en modo simulación**: cada integración (correo, calendario, Stripe, WhatsApp) que no tenga credenciales en `.env` se simula en vez de fallar, así que el flujo completo se puede probar en local sin cuentas externas. Cuando pones las credenciales, empieza a funcionar de verdad sin tocar código.

> El estado del proyecto y las decisiones ya tomadas están en `../ESTADO.md`; la guía técnica, en `../CLAUDE.md`.

---

## Qué hace

- **Inscripción (`POST /api/inscripcion`)** — valida el cupo del grupo y abre el pago 1/5 de $500 MXN en Stripe Checkout, con **tarjeta o transferencia bancaria** (cada alumno tiene una CLABE propia y fija). Al confirmarse el pago (webhook `/webhook/stripe`) se crea el alumno, se generan sus 5 pagos (semanas 0/2/4/6/8) y se ocupa su lugar.
- **Pagos 2-5 (cron horario)** — cerca de cada vencimiento genera una liga de Stripe y se la manda por correo. Las transferencias que llegan a su CLABE se registran solas.
- **Certificados** — PDF generado desde una plantilla HTML (`assets/certificado/`) y enviado por correo con liga de descarga.
- **Calendario de Outlook** — una lista de recordatorios (planeación, contacto con alumnos, Teams, examen, certificados…) que se crea como eventos en los calendarios configurados para cada grupo, con su nombre (`EXCEL-SAB-1026`).
- **Panel `/admin`** — Grupos (alumnos y plan de pagos), Pagos, Cohortes (fechas, días, cupo), Recordatorios y Errores de envío.

## Estructura

```
querify-backend/
├─ db/schema.sql        Tablas (cohortes, alumnos, pagos, mensajes, recordatorios, eventos del calendario)
├─ db/seed.sql          Las 8 cohortes iniciales (curso × modalidad, sin fecha)
├─ assets/certificado/  Plantilla HTML, firmas, logo y fuentes del certificado
├─ src/db.js            Config (.env) + conexión a Postgres + flags de simulación
├─ src/templates.js     Correos (inscripción, pago, transferencia, certificado)
├─ src/providers.js     Correo y calendario (Microsoft Graph), Stripe, WhatsApp — con simulación
├─ src/engine.js        Inscripción, alumnos, pagos, transferencias, grupos y certificados
├─ src/calendario.js    Recordatorios de cada grupo en Outlook
├─ src/certificados.js  Generación del PDF del certificado
├─ src/routes.js        /api/cohortes/:curso, /api/inscripcion, /certificados/:token, /webhook/stripe
├─ src/admin.js         Panel de administración
├─ src/server.js        Arranque (Express, cron, init de la base)
└─ scripts/             hash-password.js · db-init.js
```

---

## Correr en local (modo simulación)

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
#   CHROME_PATH=...             (Chrome instalado, para generar certificados)

npm install
npm start
```

Abre:
- Sitio: **http://localhost:3000**
- Panel: **http://localhost:3000/admin** — usuario `admin`, contraseña `querify` (fallback de demo; ver seguridad abajo).

Sin Stripe, "Apartar mi lugar" crea al alumno de inmediato, como si el pago 1 se hubiera confirmado.

---

## Seguridad del panel

El fallback `admin` / `querify` **solo** funciona si `ADMIN_PASS_HASH` está vacío. Para producción, genera un hash real:

```bash
npm run hash -- "tu-contraseña-segura"
# copia la línea ADMIN_PASS_HASH=... en tu .env
```

---

## Poner las integraciones en real

### Correo y calendario (Microsoft Graph)

El correo se envía con `POST /users/{buzón}/sendMail` como el buzón de `MAIL_FROM`, y los recordatorios se crean en los calendarios de `CALENDARIO_BUZONES`. Las dos cosas usan la misma app de Entra ID.

1. **Registrar la app**: Entra ID → **Registros de aplicaciones** → **Nuevo registro** (solo tu organización, sin URI de redirección). Copia `Id. de aplicación (cliente)` → `GRAPH_CLIENT_ID` e `Id. de directorio (inquilino)` → `GRAPH_TENANT_ID`.
2. **Secreto de cliente**: en la app → **Certificados y secretos** → **Nuevo secreto de cliente**. Copia el **valor** al momento (solo se muestra una vez) → `GRAPH_CLIENT_SECRET`.
3. **Permisos de API**: **Agregar un permiso** → **Microsoft Graph** → **Permisos de aplicación** → `Mail.Send` y `Calendars.ReadWrite`. Luego **Conceder consentimiento de administrador**: sin esto los permisos no funcionan aunque aparezcan en la lista.
4. **`.env`**: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `MAIL_FROM` (solo la dirección) y `CALENDARIO_BUZONES` (buzones separados por coma).

### Pagos (Stripe)

1. **Llaves de API**: Dashboard → **Desarrolladores** → **Claves de API**. Copia la **clave secreta** → `STRIPE_SECRET_KEY`.
2. **Transferencias**: activa **Transferencias bancarias** en Configuración → Métodos de pago.
3. **Webhook**: Dashboard → **Desarrolladores** → **Webhooks** → endpoint `https://tu-backend/webhook/stripe` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `customer_cash_balance_transaction.created`. Copia el **secreto de firma** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.
4. En `.env`: `STRIPE_CURRENCY` (default `mxn`), `PAGO_MONTO_MXN` (default `500`) y `PUBLIC_BASE_URL` con el dominio real (para las ligas que arma el cron).
5. **Probar en local**: con el [Stripe CLI](https://stripe.com/docs/stripe-cli), `stripe listen --forward-to localhost:3000/webhook/stripe`. En modo de prueba, la ficha del alumno tiene un botón "Simular transferencia".

> Si dos personas pagan casi al mismo tiempo por el último lugar de un grupo, `lugares_ocupados` puede superar `cupo_maximo` por 1: se prefiere honrar un pago ya recibido a rechazarlo.

---

## Desplegar en Railway

1. Crea un proyecto en Railway desde el repo y agrega el plugin **PostgreSQL** (inyecta `DATABASE_URL`).
2. Variables: copia las de `.env` (menos `DATABASE_URL`). Pon `NODE_ENV=production`.
3. Railway ejecuta `npm start`. Al arrancar, el backend aplica `db/schema.sql` solo (también en cada deploy).
4. Si el deploy automático desde GitHub no dispara: `railway up --service querify-backend --ci` desde la raíz del repo.

El cron horario necesita que el servicio no se duerma; por eso Railway y no el plan gratuito de Render.

---

## Variables de entorno

Todas están documentadas en **`.env.example`**. Lo que dejes vacío corre en modo simulación, sin romper el flujo.
