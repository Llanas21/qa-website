# Querify Analytics — Estado del proyecto

Última actualización: 12 de agosto de 2026

## Qué es

Sistema web para Querify Analytics, academia de análisis de datos operada
en solitario (Excel, SQL Server, Power BI, Python — cursos en vivo por
Microsoft Teams, mercado México). Instagram atrae prospectos por DM; este
sistema captura sus datos de contacto por un formulario web y automatiza
el seguimiento posterior (el punto de fuga que se quería resolver: gente
que pregunta precio y desaparece).

## Estructura del repositorio

```
querify-web/          Sitio público, estático (HTML/CSS/JS, sin dependencias)
  index.html             Home
  gracias.html           Pantalla post-formulario
  cursos/*.html           4 páginas de curso (temario real de cada curso)
  assets/css/styles.css   Toda la identidad visual vive en :root
  assets/js/app.js        Validación de formulario + envío

querify-backend/       Backend Node.js (Express + PostgreSQL)
  src/                    Lógica: db, engine, providers, routes, admin, server
  db/                     schema.sql + seed.sql
  scripts/                Utilidades (hash de contraseña, init de BD)
  README.md               Cómo correr, desplegar y conectar credenciales reales
  .env.example            Todas las variables documentadas

brief-proyecto.md      Brief original (fases 1-4: planeación, arquitectura,
                        UI y funcionalidades). Es el histórico de decisiones
                        de diseño de fondo — ya no es el documento de trabajo
                        activo, este ESTADO.md lo es.
```

## Estado actual

- [x] Sitio completo y funcionando (home + 4 cursos + gracias)
- [x] Formulario con validación (nombre obligatorio, WhatsApp o correo,
      honeypot anti-spam)
- [x] Backend construido y probado (21/21 pruebas de integración):
      alta de prospectos, deduplicado de 14 días, motor de secuencia
      (recordatorio 24h → valor 72h → cierre 7 días), webhook de WhatsApp
      que detiene la secuencia si el prospecto responde
- [x] Panel de administración (`/admin`): lista con filtros, detalle con
      timeline, errores de envío, edición de fechas de inicio
- [x] Identidad visual ajustada: tema claro, azul principal claro
      (#3B82F6), sin efectos de glow, tipografías Montserrat + Work Sans
- [x] Probado en local (compu) y desde el celular en la misma red WiFi
- [x] Correo (respaldo) resuelto vía **Microsoft Graph** (`sendMail` como
      buzón compartido `noreply@...`), ya no por SMTP — el tenant tiene
      Security Defaults activado y no ofrece contraseñas de aplicación.
      Reutiliza la misma app de Entra ID que la bitácora a Excel/SharePoint.
      Código, `.env.example` y `README.md` ya actualizados.

- [x] **`querify_inscripcion` ya quedó `APPROVED` y probada funcional**
      (verificado 16 ago 2026): envío directo de prueba al número de
      pruebas del usuario, confirmado recibido de verdad en el teléfono
      (no solo `accepted` de la API). Mientras estuvo pendiente, un
      alumno que pagara dejando **solo WhatsApp (sin correo)** no recibía
      ninguna confirmación automática — pasó con una prueba real (alumno
      #6, "Norma Zapata", solo WhatsApp), ya no debería repetirse. Con
      esto resuelto, ya no hay motivo para seguir posponiendo la
      migración de Stripe a Live (ver pendiente abajo).
- [x] **Confirmación real al apartar lugar** (14 ago 2026, corregido): un
      usuario probó el flujo completo en producción (pago real con
      tarjeta de prueba) y nunca le llegó nada, aunque la pantalla de
      gracias decía "te contactaremos por WhatsApp" — `confirmarInscripcion`
      solo dejaba una nota interna, nunca mandaba nada de verdad. Ahora
      manda la plantilla `inscripcion` (WhatsApp→correo, igual que el
      resto del sistema). Nueva plantilla creada en ambas WABAs
      (`TPL_INSCRIPCION`, default `querify_inscripcion`), en PENDING —
      mientras se aprueba, cae a correo real automáticamente.
- [x] Apartado de lugar con pago real (Stripe) y cupo limitado por cohorte:
      `POST /api/inscripcion` valida cupo y crea una Checkout Session de
      $500 MXN; el webhook confirma el pago 1, crea al alumno, genera el
      plan de 5 pagos (semanas 0/2/4/6/8) y ocupa el cupo. El cron cobra
      los pagos 2-5 (link de Stripe por WhatsApp→correo cerca del
      vencimiento). Panel: `/admin/cohortes` (fecha + cupo) y
      `/admin/alumnos` (plan de pagos, marcar pagado a mano). Corre en
      modo simulación sin credenciales de Stripe, igual que el resto del
      sistema.
- [x] **Desplegado en Railway**: proyecto `querify-analytics`, servicio
      `querify-backend` (conectado al repo de GitHub, aunque el
      auto-deploy en push nunca disparó solo en la práctica — usar
      `railway up --service querify-backend --ci` para forzarlo) + plugin
      de Postgres administrado. La raíz del repo necesitó un `package.json`
      mínimo + `railway.json` (build/start commands
      `cd querify-backend && npm ...`) porque el backend sirve el sitio
      desde `../querify-web`, fuera de `querify-backend/` — sin esto
      Railpack no detectaba el lenguaje del monorepo.
- [x] **Dominio propio**: `https://querifyanalytics.com` (comprado en
      Cloudflare, 15 ago 2026) — CNAME raíz → target de Railway (`p7som3hx
      .up.railway.app`) + TXT de verificación, proxy de Cloudflare
      apagado ("DNS only") para no interferir con el certificado SSL de
      Railway. `PUBLIC_BASE_URL`/`CORS_ORIGINS`, el webhook de Stripe (se
      actualizó la URL del endpoint existente, mismo secreto) y el webhook
      de WhatsApp (dashboard de Meta) ya apuntan aquí. La URL vieja
      (`https://querify-backend-production.up.railway.app`) se queda
      como alias — sigue funcionando, no hay que migrar nada más si se
      usa por accidente.
- [x] **WhatsApp con número real** (ya no el de prueba): migrado desde la
      app de WhatsApp Business vía Meta (Phone Number ID
      `1191736867364483`, número `+52 1 844 347 2957`). El token
      permanente (System User) sí sirve para ambas cuentas, pero **las
      plantillas NO se compartieron** — ver nota abajo. Webhook apuntando
      al dominio de Railway.
- [x] **Las 5 plantillas ya están APPROVED en ambas WhatsApp Business
      Accounts** (14 ago 2026).
- [x] **WhatsApp del número real ya manda de verdad** (14 ago 2026) —
      confirmado con un envío entregado y visto en el teléfono, no solo
      por el `200`/`"accepted"` de la API (eso solo confirma que Meta
      encoló la solicitud, no que llegó — ver nota abajo). **WhatsApp en
      producción queda 100% funcional.**
- [x] **Stripe conectado en modo Test**, webhook permanente creado por API
      apuntando también a Railway (ya no depende de la CLI de Stripe
      corriendo en local). Falta pasar a modo Live (ver pendientes abajo).

**Nota importante (WhatsApp real no mandaba — resuelto, moneda de cobro
sin configurar):** el número real (WABA `2271408477014264`) tenía todo
lo demás listo (plantillas aprobadas, token, webhook) pero todo envío
fallaba silenciosamente con `"Business eligibility payment issue"`
(código `131042`): la WhatsApp Business Account no tenía moneda/forma de
pago configurada, algo que Meta exige aunque el envío en sí sea gratis.
Se descubrió porque el webhook de esa WABA tampoco estaba suscrito a
nuestra app (`subscribed_apps` vacío — corregido con un `POST` a
`/{waba-id}/subscribed_apps`, ese `POST` no hay que repetirlo), así que
la falla nunca se vio hasta agregar un log temporal del payload de
`statuses` y forzar un reenvío. **Se resolvió** agregando moneda y
tarjeta en el billing hub de esa cuenta — el primer intento después de
poner solo la moneda siguió fallando (mismo código, mensaje ligeramente
distinto: "errors related to your payment method"), hizo falta también
la tarjeta. `routes.js` ahora loguea permanentemente cualquier `status:
'failed'` del webhook (con el código/detalle de Meta) para detectar esto
más rápido si vuelve a pasar — no hace falta otro log temporal.

**Nota importante (dos WhatsApp Business Accounts distintas):** al migrar
el número real, Meta creó una WABA **nueva** (`2271408477014264`,
verified_name "Querify Analytics") en vez de meter el número real a la
WABA original del número de prueba (`1041475812138605`). Las plantillas
son por-WABA, no por-cuenta-de-Meta — así que **hubo que crear las 5
plantillas por segunda vez** en la WABA nueva. Resultado:

| | WABA prueba `1041475812138605` | WABA real `2271408477014264` |
|---|---|---|
| Número | `1256054337592814` (prueba) | `1191736867364483` (real) |
| `TPL_BIENVENIDA` | `querify_bienvenida_v2` (el original quedó roto, ver nota de abajo) | `querify_bienvenida` (sin conflicto aquí) |
| Las otras 4 plantillas | mismo nombre en ambas | mismo nombre en ambas |
| Dónde se usa | `.env` local (a propósito) | Railway/producción |

Si alguna vez hay que tocar plantillas de nuevo, recordar que son **dos
cuentas separadas** — un cambio en una no se refleja en la otra.

**Nota (WhatsApp — número real vs. de prueba):** el número de prueba de
Meta puede mandar la plantilla `hello_world` sin restricciones, pero un
número real **no** — un número real solo puede mandar (a) una plantilla
ya aprobada, o (b) texto libre dentro de la ventana de 24h después de que
el cliente escriba primero (`hello_world` da el error `#131058` en un
número real).

**Nota (WhatsApp):** la plantilla de bienvenida se llama
`querify_bienvenida_v2` en Meta y en `TPL_BIENVENIDA`, no
`querify_bienvenida` — un intento anterior dejó esa versión con contenido
roto, y al borrarla Meta tardó más de lo normal en liberar el nombre para
un reintento. No es necesario corregirlo, solo que no sorprenda el `_v2`
al buscarla en WhatsApp Manager.

**Nota (entorno local vs. producción):** a propósito, el `.env` local
sigue apuntando al número de prueba de WhatsApp (Railway ya usa el real)
— evita que una prueba en la laptop le mande algo real a un cliente. No
sincronizar `WHATSAPP_PHONE_NUMBER_ID` entre ambos entornos.

**Nota (bloqueo temporal de la API de Meta, 13 ago 2026):** en medio de
varias pruebas seguidas (crear/borrar/leer plantillas por API en poco
tiempo), Meta bloqueó por completo la API para la app/token
("`API access blocked`" en *cualquier* llamada, hasta las más básicas) por
"actividad inusual" y pidió verificar la cuenta manualmente en el
dashboard — se resolvió solo, sin tocar código. Si vuelve a pasar: no es
un bug, hay que verificar la cuenta en developers.facebook.com y
reintentar después.

**Pendiente para producción real:**
- [ ] Contenido: testimonios reales (hoy son de ejemplo), confirmar
      teléfonos/redes del footer, cargar fecha de inicio para la modalidad
      **entre semana** (hoy solo "sabatino" tiene fecha, en los 4 cursos;
      "entre semana" está vacía — el usuario aún no tiene esas fechas
      definidas; el sitio ya maneja bien el caso sin fechas, no bloquea)
- [x] **Limpieza de datos de prueba en producción** (16 ago 2026): se
      borraron los 4 prospectos y 7 alumnos de prueba (propios, ningún
      cliente real) y se resetearon `lugares_ocupados` a 0 en las 8
      cohortes. Incluyó un alumno de prueba que se coló por accidente el
      mismo día (ver nota abajo).

**Nota importante (16 ago 2026 — un checkout de prueba en local también
escribió en producción):** al probar el flujo de inscripción en local con
`stripe listen`, Stripe mandó el evento `checkout.session.completed` **a
todos los webhooks registrados de esa cuenta de prueba**, no solo al que
escuchaba en local — el webhook permanente de producción también lo
recibió y creó un alumno + 5 pagos + subió cupo + mandó confirmación real
por correo, todo en producción, sin querer. Se limpió como parte del
punto de arriba. **Mientras Stripe siga en modo Test en ambos lados
(local y producción comparten la misma cuenta de prueba), cualquier
checkout de prueba local puede volver a filtrarse a producción.** Esto
deja de ser posible en cuanto se migre producción a llaves Live (local
seguiría en Test, cuentas/webhooks ya no se cruzan).
- [x] ~~Que Meta apruebe el nombre para mostrar del número real~~ — ya
      resuelto (15 ago 2026): `name_status: AVAILABLE_WITHOUT_REVIEW`,
      "Querify Analytics" quedó activo sin necesitar revisión manual.
      Número verificado (`code_verification_status: VERIFIED`) y calidad
      **GREEN**. No era un bloqueante real, solo faltaba confirmarlo.
      Prueba adicional con un número ajeno (8445503212): la plantilla
      `querify_bienvenida` se mandó y la API respondió `accepted`, pero el
      webhook de confirmación de entrega no se pudo verificar porque el
      servicio se reinició (redeploy) antes de poder revisar el log — no
      es un fallo confirmado, solo quedó sin verificar. Si hace falta
      certeza total, repetir la prueba y revisar el log en los minutos
      siguientes (antes de cualquier redeploy).

**Nota (16 ago 2026 — pruebas locales aceleradas, ambas OK):**
- **Secuencia de seguimiento completa** probada en local con
  `SEQ_STEP1/2/3_HOURS` bajados a minutos y `CRON_SCHEDULE=* * * * *`
  (restaurado después a los valores reales): los 4 mensajes
  (bienvenida→recordatorio→valor→cierre) se mandaron y la API los aceptó,
  pero **no llegaron al teléfono** — diagnosticado: el Número de Prueba de
  Meta solo entrega a destinatarios agregados y verificados a mano en
  Meta for Developers → app → WhatsApp → Configuración de la API →
  "Para". Es una limitación **solo del entorno local** (el número real de
  producción ya entrega de verdad, confirmado antes). Si se quiere
  volver a probar WhatsApp en local, hay que re-verificar ese número ahí.
- **Flujo completo de inscripción** (apartar lugar → pago Stripe Test →
  webhook → alumno + 5 pagos → confirmación) probado de punta a punta en
  local con Puppeteer + `stripe listen`: pagó con tarjeta de prueba, el
  webhook `checkout.session.completed` se procesó, se creó el alumno, el
  pago 1 quedó `pagado`/`stripe`, los pagos 2-5 quedaron `pendiente` con
  fechas correctas, el cupo de la cohorte subió, y la confirmación
  `querify_inscripcion` se mandó por **correo** (se dejó el formulario
  sin WhatsApp a propósito, por la limitación de arriba) — pendiente que
  el usuario confirme si llegó a la bandeja de verdad.
- [x] **Stripe migrado a modo Live** (16 ago 2026): nuevo webhook Live
      creado por API (`we_1U4yMq...`, evento `checkout.session.completed`,
      apunta a `https://querifyanalytics.com/webhook/stripe`), Railway
      actualizado con `STRIPE_SECRET_KEY` (`sk_live_...`) y
      `STRIPE_WEBHOOK_SECRET` nuevos, `/health` confirma `stripe: false`
      (ya no simula). Se borró también el webhook viejo en modo Test que
      apuntaba a producción — con esto el problema de la nota de arriba
      (checkout de prueba local filtrándose a producción) queda resuelto
      de raíz: local sigue en Test, producción ya está en Live, cuentas y
      webhooks ya no se cruzan. **A partir de ahora, cualquier pago real
      en el sitio cobra dinero de verdad.**
- [ ] Aplicar la restricción de `Mail.Send` solo al buzón `noreply@...`
      vía `New-ApplicationAccessPolicy` en PowerShell (opcional pero
      recomendado — por default el permiso alcanza para enviar como
      cualquier buzón del tenant)
- [ ] La sesión del panel `/admin` usa `MemoryStore` (advertencia de
      Express en los logs de Railway): se pierde al reiniciar/redeploy y
      no escala a más de una instancia. No es urgente para un solo admin
      y una sola instancia, pero si crece, cambiar a un store persistente
      (ej. `connect-pg-simple` contra el mismo Postgres)

## Decisiones ya tomadas — no reabrir sin razón concreta

- **WhatsApp:** Meta Cloud API directa (no un proveedor tercero)
- **Backend:** Node.js + Express (se evaluó Python/FastAPI, se eligió Node)
- **Base de datos:** PostgreSQL
- **Hosting recomendado:** Railway (no Render, porque el cron horario
  necesita que el servicio no se duerma)
- **Canales:** WhatsApp principal con respaldo por correo; Instagram DM
  se mantiene manual, no se automatiza
- **Correo:** Microsoft Graph (`sendMail` como buzón compartido), no SMTP
  — el tenant tiene Security Defaults activado y no ofrece contraseñas de
  aplicación; Graph además reutiliza la misma app que la bitácora a
  Excel/SharePoint (una sola credencial para ambas cosas)
- **Regla de duplicados:** contacto repetido en <14 días → actualiza el
  curso de interés sin reiniciar la secuencia; ≥14 días → se trata como
  prospecto frío que volvió y la secuencia se reinicia desde cero
- **Identidad visual:** tema claro, azul #3B82F6 / #2563EB, sólidos y
  degradados discretos (nada de glow ni sombras grandes), tipografías
  Montserrat (títulos) + Work Sans (texto) + IBM Plex Mono (detalles
  tipo código)
- **Cohortes reemplaza a `fechas_inicio`:** una sola tabla para fecha de
  inicio + cupo (antes eran conceptos separados). Se decidió fusionar en
  vez de mantenerlas por separado porque el mensaje de "valor" y el cupo
  real deben mostrar siempre la misma fecha — mantenerlas aparte hubiera
  significado editar la fecha en dos lugares y arriesgar que se
  desincronizaran. `engine.proximaFecha()` ahora lee de `cohortes`.
- **Pagos 2-5 vía WhatsApp, no tarjeta guardada:** se cobra mandando un
  link de Stripe cerca del vencimiento (mismo canal y cron que el
  seguimiento), no se implementa cobro recurrente automático con tarjeta
  guardada — mantiene todo en un solo mecanismo de envío ya probado.
- **El cupo se ocupa al confirmar el pago 1, no al iniciar el checkout:**
  evita reservar lugares de gente que abre el link y no paga.

## Cómo correr el proyecto en local

Instrucciones completas en `querify-backend/README.md`. En resumen:
1. Backend y base de datos: `cp .env.example .env`, llenar `DATABASE_URL`,
   `npm install`, `npm start`
2. El backend sirve el sitio automáticamente si `STATIC_DIR=../querify-web`
3. Sitio: `http://localhost:3000` — Panel: `http://localhost:3000/admin`

## Producción (Railway)

- Proyecto: `querify-analytics` (workspace de Railway de Jose Luis) —
  servicios `querify-backend` (conectado al repo de GitHub, rama `main`,
  auto-deploy en cada push) y `Postgres` (plugin administrado).
- URL: `https://querifyanalytics.com` (dominio propio, DNS en Cloudflare;
  `https://querify-backend-production.up.railway.app` sigue funcionando
  como alias)
- Variables de entorno: viven solo en Railway (`railway variable list
  --service querify-backend`), no en este repo. Si cambias una llave o
  credencial ahí, no lo olvides — el `.env` local es independiente.
- Redeploy manual si el auto-deploy de GitHub no dispara:
  `railway up --service querify-backend --ci` desde la raíz del repo.

## Cómo retomar este proyecto en el futuro (con Claude o con quien sea)

1. Comparte este archivo (`ESTADO.md`) primero — resume todo sin tener
   que releer el historial completo del chat.
2. El código fuente de verdad vive en GitHub, no en archivos sueltos
   descargados del chat (evita el problema de estructura incompleta).
3. Para cambios de diseño/contenido pequeños: basta con describir el
   cambio. Para cambios de arquitectura (proveedor, hosting, flujo de
   datos): revisar primero la sección "Decisiones ya tomadas" de arriba,
   para no reabrir algo ya resuelto sin querer.
