# Querify Analytics — Estado del proyecto

Última actualización: 15 de octubre de 2026

## Qué es

Sistema web para Querify Analytics, academia de análisis de datos operada
en solitario (Excel, SQL Server, Power BI, Python — cursos en vivo por
Microsoft Teams, mercado México).

**Propósito del sitio público cambió el 13 oct 2026 — ver la nota fechada
más abajo.** Originalmente capturaba datos de contacto por un formulario
("solicitar información") y automatizaba el seguimiento posterior (el
punto de fuga que se quería resolver: gente que pregunta precio y
desaparece). Ahora el sitio está enfocado 100% a conversión directa
("Apartar mi lugar") — ya no se pide ni se guarda información de nadie
que solo esté preguntando; quien tiene dudas antes de pagar se va por un
link directo de WhatsApp, atendido a mano. El motor de captura y
seguimiento sigue existiendo en el backend (histórico + por si se
reactiva algún día), solo que el sitio ya no lo alimenta.

**Pivote del panel admin en curso (15 oct 2026):** con el sitio público
ya sin captura de leads (los prospectos ahora se manejan a mano en
WhatsApp Business), el usuario decidió convertir `/admin` en una
plataforma de administración más amplia para la academia — enfocada a
mobile, pensada para usarse como **PWA instalable con notificaciones
push** (avisos de pagos recibidos/vencidos/fallidos primero), y a la que
se le irán agregando automatizaciones de procesos internos con el
tiempo. Decisiones tomadas en esa conversación:
- **"Prospectos" sale del todo del menú** del panel (no solo se
  archiva) — los datos siguen en la tabla `prospectos`, solo ya no hay
  una sección del panel dedicada a ellos.
- Notificaciones push: arrancar con eventos de **pagos** (recibido,
  vencido, fallido) — no con errores técnicos del sitio (segunda
  prioridad, no la primera).
- El **push de verdad** (service worker + suscripción + VAPID + disparar
  la notificación en los eventos de pago) todavía **no está construido**
  — sigue siendo la dirección a seguir. Lo que sí se hizo ya: la base de
  instalabilidad de la PWA (manifest) y el rediseño completo del panel
  (ver abajo), más "Prospectos" ya sale del nav.

- [x] **Rediseño completo del panel admin, mobile-first (15 oct 2026)**
  — antes era un panel de prospectos con tema oscuro genérico, sin
  relación visual con el sitio público. Ahora:
  - Misma identidad que el sitio público: mismos tokens de color/tipografía
    de `querify-web/assets/css/styles.css` (azul `#2563EB`, Poppins,
    radios/sombras discretas) copiados directo al `<style>` de `layout()`
    en `admin.js` — ya no son hojas de estilo separadas de verdad, pero
    se ven como una sola marca.
  - **Navegación tipo app**: barra superior (logo o flecha "atrás" + botón
    de salir) + **barra inferior fija de 3 pestañas** (Alumnos, Cohortes,
    Errores — con `env(safe-area-inset-bottom)` para no chocar con el
    home indicator de iPhone). "Prospectos" ya no tiene pestaña (sigue
    accesible por URL directa para consultar histórico, pero fuera de la
    navegación principal).
  - **Tablas densas reemplazadas por tarjetas/listas** en las secciones
    que importan en celular: lista de alumnos, cohortes (una tarjeta por
    generación en vez de una fila de tabla ancha), plan de pagos de un
    alumno (lista tipo "stepper" con ✓/número y estado con color), y
    errores de envío (se lee como un feed de notificaciones — encaja
    bien con que más adelante esto mismo dispare push reales). La tabla
    de prospectos (no prioritaria) se dejó como tabla, solo envuelta en
    un contenedor con scroll horizontal para no romper el layout.
  - **Base de PWA instalable**: `<link rel="manifest">` nuevo
    (`GET /admin/manifest.webmanifest`, `start_url: /admin`, ícono del
    logo, `display: standalone`) + meta tags de `theme-color` y
    `apple-mobile-web-app-*`. El service worker y el push en sí
    (`VAPID`, tabla de suscripciones, disparar notificación en
    pago recibido/vencido/fallido) son la siguiente fase, no estaban en
    el alcance de esto.
  - **Bug real encontrado y corregido durante las pruebas**: las ligas
    largas de Stripe en el historial de mensajes (sin espacios) rompían
    el ancho de toda la página en celular — `overflow-wrap` no estaba
    puesto en `.timeline .body` (ni en `body` como red de seguridad
    general). Se corrigió y se verificó por código (`scrollWidth` ==
    `clientWidth`) en las 6 páginas principales, no solo a ojo.
  - Probado con Puppeteer emulando un iPhone de verdad (no solo
    `--window-size`, esa técnica ya se sabe que da falsos positivos —
    ver nota de la sesión del 15 ago) + una prueba funcional real
    (marcar un pago como pagado) para confirmar que el cambio visual no
    rompió ninguna lógica.
  - Toda la lógica de negocio (queries, validaciones, redirects) quedó
    exactamente igual — este fue un cambio 100% de presentación.

- [x] **"Alumnos" reestructurado por grupos (15 oct 2026)**: la pantalla
  ya no lista alumnos directamente, lista **grupos** (una tarjeta por
  cohorte que ya tiene al menos un alumno, más reciente primero por
  `fecha_inicio DESC`). Tocar un grupo abre `/admin/grupo/:id` con sus
  alumnos; de ahí se entra al detalle de cada alumno como antes (el botón
  "volver" del detalle ahora regresa al grupo, no a la lista plana).
  Cohortes sin ningún alumno no aparecen en Alumnos (quedan solo en
  Cohortes) — para no dejar un callejón sin salida al dar de alta al
  primer alumno de una cohorte nueva por transferencia, se agregó un link
  "Ver alumnos de este grupo →" en cada tarjeta de `/admin/cohortes` que
  lleva a `/admin/grupo/:id` sin importar si ya tiene alumnos o no. El FAB
  de "Dar de alta un alumno" vive ahora dentro de cada grupo con la
  cohorte precargada (ya no hay selector de cohorte en el formulario).
  Bug real encontrado y corregido durante las pruebas: el conteo de
  alumnos por grupo usaba `COUNT(a.*)` después de un `LEFT JOIN pagos`,
  lo que multiplicaba cada alumno por su número de pagos (un alumno con 5
  pagos se contaba como "5 alumnos") — se corrigió a `COUNT(DISTINCT a.id)`.
  Esa pantalla se renombró de "Alumnos" a **"Grupos"** en el menú y el
  título (la ruta interna sigue siendo `/admin/alumnos`, solo cambió el
  texto visible).

- [x] **Nueva pantalla "Pagos" — ledger global (15 oct 2026)**:
  `/admin/pagos`, cuarta sección del menú lateral. A diferencia del plan
  de pagos de `/admin/alumno/:id` (acotado a un alumno), esta junta los
  pagos de **todos** los alumnos en un solo lugar — pendientes, vencidos
  y pagados (de Stripe o manuales) — con un filtro por estado. Cada fila
  enlaza al detalle del alumno correspondiente. El FAB (mismo patrón
  FAB + modal ya establecido) deja **registrar un pago manual** (el caso
  de alguien que paga el pago 2-5 por transferencia): un solo select con
  todos los pagos pendientes/vencidos de la academia (alumno + curso +
  número de pago + monto + vencimiento en una sola línea, para evitar un
  selector encadenado alumno→pago que habría necesitado JS extra) y un
  botón para marcarlo pagado — reutiliza `engine.confirmarPago()`, el
  mismo código que ya usaba el botón "Marcar pagado" dentro del alumno.
  El FAB se oculta solo si no queda ningún pago pendiente en toda la
  academia (no debería pasar en la práctica, pero evita un botón sin
  nada que hacer).
  - **"Liquidar" en `/admin/alumno/:id`**: para cuando alguien paga de un
    jalón todo lo que le falta (en vez de registrar pago por pago), un
    botón junto al plan de pagos marca TODOS los pagos pendientes/vencidos
    de ese alumno como pagados a la vez (con confirmación del navegador
    antes de ejecutar). Solo aparece si le queda algo pendiente. Bug
    visual encontrado y corregido en las pruebas: el texto del botón
    (incluye el conteo dinámico de pagos) se salía de la píldora por el
    `white-space:nowrap` normal de `.btn` — se cambió a `.btn.block` con
    `white-space:normal` para que envuelva en vez de desbordarse.

- [x] **Dos rondas de retroalimentación de diseño sobre el rediseño del
  panel** (15 oct 2026), todas ya probadas con Puppeteer (emulación real
  de iPhone) y funcionando:
  - La barra inferior de 3 pestañas se reemplazó por un **menú lateral
    (drawer) deslizable**, abierto con un botón de hamburguesa en la
    barra superior. Se eligió así para poder agregar más pantallas
    después sin pelear por ancho horizontal. **Sin botón de cerrar
    dentro del menú** — se cierra únicamente tocando fuera de él (overlay),
    por pedido explícito: un botón "X" se sentía redundante.
  - Bug real encontrado y corregido: el enlace "Errores" del menú se veía
    corrido hacia la derecha respecto a los demás. Causa: el selector CSS
    `.drawer-link:last-child` se evalúa por cada padre por separado, así
    que además de aplicarle el margen a "Salir" (la intención original)
    también se lo aplicaba a "Errores" (último hijo de su propio
    contenedor hermano). Se corrigió dándole a "Salir" su propia clase
    (`drawer-logout`) en vez de depender de `:last-child`.
  - Login: centrado vertical real con flex + `100dvh` en vez de un
    `margin-top` fijo en vh (se veía descentrado en pantallas altas).
  - Input de fecha (`/admin/cohortes`) reportado por el usuario con ancho
    distinto a "Cupo máximo" y texto centrado — no reproducible en Chrome
    (datos de prueba y capturas confirmaron que ahí ya rendía bien), muy
    probablemente un comportamiento nativo de Safari/iOS. Se corrigió a
    ciegas con las soluciones documentadas para ese bug específico:
    `text-align:left` en el input más
    `input[type=date]::-webkit-date-and-time-value{text-align:left}`
    (Safari renderiza el valor de fecha con un pseudo-elemento interno
    que ignora el `text-align` normal del input), además de `min-width:0`
    global y `max-width:100%` en los inputs tipo texto. **Pendiente de
    confirmar en un dispositivo real** — no se puede verificar el síntoma
    original en este entorno (solo Chrome).
  - **Principio de diseño establecido para todo el panel**: la app no
    tiene que ser autodescriptiva — quien la usa recibe capacitación
    sobre sus funciones, así que no hace falta texto explicativo de "cómo
    funciona esto". Se recortaron párrafos tipo tutorial en Alumnos,
    Cohortes y Errores (ej. "Se crean automáticamente al confirmarse el
    pago 1 por Stripe, o manualmente aquí abajo...", "Texto libre — solo
    funciona dentro de las 24h..."). Tenerlo en cuenta al agregar
    pantallas nuevas: evitar `.sub` explicativos salvo que sea un dato
    (conteo, fecha, origen), no una instrucción de uso.
  - **"Dar de alta un alumno" (en Alumnos) y "Nueva cohorte" (en
    Cohortes)** dejaron de ser formularios siempre visibles en una
    tarjeta — ahora son un **botón flotante (FAB)** en la esquina inferior
    derecha que abre una **hoja/modal** deslizable desde abajo con el
    mismo formulario de siempre (misma validación, mismos endpoints de
    POST, sin cambios de lógica). Patrón reutilizable: la función
    `fabModal()` en `admin.js` genera el botón + overlay + hoja + el
    script de abrir/cerrar; se usa pasándole un `id`, `label`, `titulo` y
    el HTML del formulario. Pensado para reusarse en futuras pantallas
    que necesiten un "agregar algo" sin ocupar espacio fijo.

- [x] **Alta manual de alumnos desde el panel** (15 oct 2026) — para
  quien paga por transferencia u otro medio fuera de Stripe. Nuevo
  formulario en `/admin/alumnos` (selector de cohorte con cupo
  disponible — una cohorte llena ni siquiera aparece ahí — + nombre +
  correo obligatorio + WhatsApp opcional, asume `+52`). Reutiliza
  `confirmarInscripcion()` (ahora acepta un `metodo` — `'stripe'` por
  default, `'manual'` aquí) a través de la nueva `engine.altaAlumnoManual()`:
  mismo resultado final que el flujo de Stripe — pago 1 queda
  `pagado`/`manual`, se generan los 5 pagos, se ocupa el cupo, se manda
  la confirmación por correo, y entra igual al cron de recordatorios de
  los pagos 2-5. Probado en local: alta exitosa con plan de pagos
  correcto y correo de confirmación enviado; cohorte llena
  correctamente excluida del selector.

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

**Cambio de proceso en curso (24 ago 2026 — número real saliendo de la API):**
El usuario está reorganizando su proceso de atención y quiere mover el
número real de WhatsApp de la API (Cloud API) a la app normal de WhatsApp
Business, para contestar a mano. Eso lo hace él desde su teléfono (no es
algo que se ejecute por código — Meta pide verificación por SMS al migrar
un número de la API de vuelta a la app). Decisión tomada: **pausar TODO
el seguimiento automático proactivo** mientras tanto (no elegido: caer a
correo automáticamente, ni dar de alta un número nuevo dedicado a la API).

- [x] **Desplegado y activo en producción (31 ago 2026):** nuevo
      interruptor `AUTOMATIZACION_PAUSADA=true` en Railway. No se manda
      bienvenida al alta, no corre `correrSecuencia`
      (recordatorio/valor/cierre), no corre `revisarPagosPorVencer`
      (recordatorios de pago 2-5) — todo queda como no-op, sin tocar
      credenciales de WhatsApp. **La confirmación de inscripción
      (`querify_inscripcion`) al pagar SIGUE activa a propósito** — es un
      recibo transaccional de un pago real, no seguimiento proactivo; si
      el número ya no funciona por la API, cae a correo automáticamente
      por el mecanismo normal de respaldo (es un fallo real de la API, no
      un "simulado"). Aviso visible en todas las páginas del panel admin
      mientras esté pausado. El usuario ya migró el número real a la app
      de WhatsApp Business ese mismo día. `/health` confirmado sano tras
      el despliegue.
- [x] **Decisión final (1 oct 2026): el sitio solo maneja correo, ya no
      WhatsApp, de forma permanente** (no fue solo una pausa temporal
      mientras migraba el número — el usuario decidió quedarse así).
      Cambios:
      - `engine.canalDe()` y todos los `enviarConVars()` (bienvenida,
        secuencia, confirmación de inscripción, recordatorios de pago)
        ahora fijan `canal: 'correo'` siempre, sin importar si hay
        teléfono. La maquinaria de WhatsApp (`providers.sendWhatsAppTemplate`,
        el fallback en `enviarConVars`) queda intacta sin borrar, por si
        algún día se reconecta un número — simplemente ya no se invoca.
      - El campo de WhatsApp **se queda en los formularios** del sitio
        (decisión explícita del usuario) como dato de referencia opcional
        — ya no se usa para mandar nada, solo queda visible en `/admin`.
      - `gracias.html`/`inscripcion-gracias.html` ahora siempre dicen "te
        contactaremos por correo" (antes dependía de si dejaste teléfono).
      - Nueva columna `alumnos.archivado` (default false): cuando es
        true, `revisarPagosPorVencer` lo excluye por completo (no le
        manda recordatorios de pago 2-5). Botón "Archivar"/"Reactivar" en
        `/admin/alumno/:id`.
      - **Se archivó todo lo que ya existía como un lote histórico
        cerrado**, antes de reactivar la automatización: todos los
        prospectos con `estado_secuencia='activa'` se pasaron a
        `'finalizada'` (con nota en su timeline), y todos los alumnos
        existentes se marcaron `archivado=true` (con nota). Sus datos e
        historial de mensajes siguen intactos y visibles en `/admin`,
        solo que no reciben nada automático — esto era justo el pendiente
        que se había dejado anotado aquí mismo ("revisar antes de quitar
        el interruptor si conviene finalizar a los prospectos viejos").
      - `AUTOMATIZACION_PAUSADA` se quitó/puso en `false` — el
        seguimiento ya corre de nuevo, pero correo-only, y solo afecta a
        prospectos/alumnos **nuevos** de aquí en adelante (los viejos
        quedaron fuera por el archivado de arriba).
      - Probado en local antes de desplegar: un lead nuevo con teléfono
        quedó con `canal='correo'` y la bienvenida se mandó por correo de
        verdad; el botón archivar/desarchivar de alumno funciona.

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

**Prueba real en Live (18 ago 2026):** cuenta de Stripe verificada por
API (`charges_enabled`/`payouts_enabled`/`card_payments`: todo `true`/
`active`; nota: `payouts.schedule.interval` es `manual`, el dinero no se
deposita solo, hay que retirarlo a mano desde el dashboard). Después, el
usuario apartó un lugar real con su propia tarjeta ($500 MXN, dinero de
verdad): sesión `cs_live_...`, webhook recibido (200), alumno + 5 pagos
creados correctamente, confirmación `querify_inscripcion` enviada por
WhatsApp real (`estado=enviado`). Se reembolsó el cargo completo
(`re_3U5bOZ...`, `status: succeeded`) y se borró el alumno/pagos de
prueba, cupo de vuelta a 0. **Stripe Live queda verificado de punta a
punta con dinero real.** Confirmación por WhatsApp también llegó de
verdad al teléfono del usuario.

- [x] **Fix: fecha de cohorte se corría un día en `inscripcion.html`**
      (18 ago 2026): `fecha_inicio` es una columna `DATE`, el backend la
      manda como medianoche UTC; `fmtFecha()` en `app.js` la formateaba
      con `new Date(f).toLocaleDateString(...)` sin fijar zona horaria,
      así que el navegador la reinterpretaba en la zona local del
      visitante — en México (UTC-6) esto corría la fecha un día atrás
      (sábado 5 sep se veía como 4 sep). Fix: agregar `timeZone: "UTC"`
      al formateador. Las demás fechas del sitio (panel admin,
      plantillas de WhatsApp/correo) se formatean del lado del servidor
      y no cruzan esa frontera, así que no tenían este bug — se revisó
      con grep para confirmar que `fmtFecha` era el único lugar afectado.
- [x] **Alta automática de prospecto para WhatsApp directo de número
      desconocido** — desplegado a producción (21 ago 2026). Antes se
      descartaba en silencio (solo visible en Meta Business Suite, no en
      `/admin`, no entraba al seguimiento). Ahora reutiliza
      `altaProspecto`/`afterIntake` (misma lógica del formulario, con
      `parseWaId` para derivar país/número del wa_id) — probado en local
      antes de subir (crea el prospecto, manda la bienvenida, registra el
      entrante, un segundo mensaje del mismo número no duplica).

- [ ] **Listo pero SIN DESPLEGAR (23 ago 2026):** responder por WhatsApp
      directo desde el panel admin. Motivo: Meta Business Suite no
      siempre da bandeja de chat para números conectados por Cloud API
      directa (el usuario no la encontró) — en vez de depender de eso, se
      agregó un cuadro de texto en `/admin/prospecto/:id` (solo si tiene
      WhatsApp) que manda texto libre vía `POST /messages` (nueva
      `providers.sendWhatsAppTexto`, nueva `engine.responderManual`, ruta
      `POST /admin/prospecto/:id/enviar-mensaje`), queda en el timeline
      como tipo `manual`. **Limitación real de WhatsApp, no de este
      código:** solo se puede mandar texto libre dentro de las 24h
      después del último mensaje entrante de esa persona; fuera de esa
      ventana Meta rechaza (el error se muestra tal cual en el panel).
      Probado en local con Puppeteer (login + mandar mensaje real +
      camino de error). Falta `git push` + `railway up --ci` cuando el
      usuario dé luz verde.

**Bug importante encontrado y corregido (21 ago 2026 — respuestas de
WhatsApp nunca llegaban al webhook):** el usuario notó que, de 13 leads
reales recibidos desde el 18 de agosto (Gilberto, Yazmin, Juan Casas,
Andres Ramírez, Rafael Hernández, Uriel Mucino, Antonio Trejo, Iván,
Kevin Kleiman, Judith, etc. — ya con bienvenida/recordatorio/valor
mandados por WhatsApp con éxito), **ninguno tenía registrada ninguna
respuesta entrante**. Se comprobó que la suscripción de la WABA a la app
(`subscribed_apps`) sí estaba bien y que el handshake `GET /webhook`
respondía bien — el problema real: en el dashboard de Meta for Developers
→ WhatsApp → Configuración → Webhooks, el campo **`messages`** estaba
**desactivado** (esto es independiente de `subscribed_apps`, que solo
liga la WABA a la app pero no dice qué campos se entregan). El usuario lo
activó y se confirmó con una prueba real (mensaje "Hola" desde su
teléfono) que ya llega correctamente. **Posible causa: se perdió al
migrar del número de prueba al número real** (nueva WABA, ver nota de
arriba sobre las dos WhatsApp Business Accounts) — ese campo no se
vuelve a marcar solo. **Si en el futuro se da de alta otro número o WABA,
revisar este campo explícitamente, no asumir que basta con
`subscribed_apps`.**

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
- [x] **Correos en HTML con marca, en vez de texto plano (13 oct 2026)**
      — `templates.js` ahora genera un `renderHtml(tipo, vars)` además del
      `render()` de texto plano de siempre (ese sigue siendo lo que se
      guarda en `mensajes.contenido` para el timeline de `/admin`, sin
      cambios ahí). El HTML real que recibe la persona: encabezado con el
      logo, tarjeta blanca centrada (560px), y un botón de call-to-action
      en bienvenida/recordatorio/valor/cierre (→ `/cursos/inscripcion.html`)
      e inscripción confirmada (→ sitio); el de **pago** destaca el monto
      grande y un botón "Pagar ahora" directo a la liga de Stripe. Todo
      con estilos en línea (inline) a propósito — `<style>` en el head no
      es confiable en clientes de correo, sobre todo Outlook. El botón es
      un `<a style="display:inline-block">` envuelto en un `<div
      style="text-align">` (no una `<table align="center">` — esa la
      ignoran los motores modernos de Gmail/Apple Mail por ser atributo
      obsoleto, aunque en un render de navegador/Puppeteer sí "se ve" bien
      por error — ojo con esto si se vuelve a tocar). `providers.sendEmail`
      manda `contentType: 'HTML'` cuando hay una versión HTML para ese
      tipo. Probado primero visualmente (Puppeteer, las 6 plantillas) y
      después con un envío real a una bandeja real — confirmado que se ve
      bien ahí también.
- [x] **Dominio propio verificado en Microsoft 365 para correo (1 oct
      2026)** — como el sitio ahora solo maneja correo (ver más arriba),
      que los mensajes llegaran a spam por mandarse desde el dominio
      genérico `*.onmicrosoft.com` se volvió un problema serio. Se agregó
      `querifyanalytics.com` como dominio personalizado en Microsoft 365:
      MX, SPF (TXT) y 2 CNAME de DKIM (`selector1`/`selector2._domainkey`,
      apuntan a infraestructura bajo el TLD real `.microsoft` que es de
      Microsoft — no es un error, el valor va completo así) agregados a
      mano en Cloudflare (el conector automático Microsoft↔Cloudflare dio
      error "URL no verificada", conocido/no solucionable del lado del
      usuario — se hizo manual sin problema) y confirmados propagados por
      DNS. DKIM activado en el admin center. El buzón compartido pasó a
      tener `contacto@querifyanalytics.com` como dirección principal
      (antes `contacto@QuerifyAnalytics.onmicrosoft.com`, que queda como
      alias). `MAIL_FROM` actualizado en Railway al nuevo correo. Probado
      con un envío real de producción (`estado: enviado`, sin error).
      **Pendiente opcional (pospuesto a propósito, el usuario dijo "lo
      agregamos después" — 1 oct 2026):** agregar registro DMARC. Valor
      listo para cuando se retome — TXT en `_dmarc` →
      `v=DMARC1; p=none; rua=mailto:contacto@querifyanalytics.com`
      (empieza en modo solo-observar; subir a `quarantine`/`reject` más
      adelante una vez confirmado que todo pasa limpio). No es
      indispensable con SPF+DKIM ya alineados, solo refuerza más.
- [ ] **Pendiente (pospuesto, 1 oct 2026): foto de perfil del buzón
      `contacto@querifyanalytics.com`.** Se intentó por `Set-UserPhoto`
      (PowerShell/ExchangeOnlineManagement) — el cmdlet no está
      disponible en la sesión del usuario aun después de
      `Connect-ExchangeOnline` (`Get-Command Set-UserPhoto` no devuelve
      nada; posible tema de rol/RBAC, sin resolver). El admin center
      tampoco deja subir foto directo porque el buzón tiene el inicio de
      sesión bloqueado (normal en un buzón compartido) — la opción de
      cámara solo aparece con sesión activa. Camino que faltaba probar:
      desbloquear sesión temporalmente → iniciar sesión en outlook.office.com
      como ese buzón → cambiar foto ahí → volver a bloquear sesión. Nota
      de alcance real: esto solo se vería en Outlook/Teams/directorio
      interno, nunca en el Gmail de los clientes (para eso hace falta
      BIMI, que depende de tener DMARC en modo exigir — ver pendiente de
      arriba). Imagen ya preparada (JPG con fondo blanco a partir del
      logo del sitio) en el scratchpad de la sesión que generó esto —
      si no sigue ahí, regenerar desde `querify-web/assets/img/querify-logo.png`.
- [ ] Aplicar la restricción de `Mail.Send` solo al buzón `noreply@...`
      vía `New-ApplicationAccessPolicy` en PowerShell (opcional pero
      recomendado — por default el permiso alcanza para enviar como
      cualquier buzón del tenant). Nota: ahora el buzón relevante es
      `contacto@querifyanalytics.com`, no `noreply@...`.
- [ ] La sesión del panel `/admin` usa `MemoryStore` (advertencia de
      Express en los logs de Railway): se pierde al reiniciar/redeploy y
      no escala a más de una instancia. No es urgente para un solo admin
      y una sola instancia, pero si crece, cambiar a un store persistente
      (ej. `connect-pg-simple` contra el mismo Postgres)

**Pivote de producto: sitio 100% enfocado a conversión (13 oct 2026).**
El usuario decidió dejar de pedir/registrar información de contacto en el
sitio — ya no quiere el formulario de "solicitar información", quiere que
cualquiera que entre se encamine directo a apartar su lugar (reducir
fricción hacia la inscripción). Decisiones tomadas en esa conversación:
- Se quita el formulario de leads **del sitio por completo** (no solo se
  esconde). El motor de captura/seguimiento del backend (`engine.js`,
  `routes.js` → `POST /api/leads`, las plantillas de
  bienvenida/recordatorio/valor/cierre) **se queda intacto sin usarse** —
  mismo criterio que WhatsApp antes: no se borra, solo deja de
  alimentarse desde el sitio.
- Para quien quiere preguntar algo antes de pagar: un link directo a
  WhatsApp (`https://wa.me/528443472957`, número real confirmado por el
  usuario — ojo, los números viejos `844 159 5050`/`844 355 3789` que
  estaban regados en varios footers **eran incorrectos/de prueba**, ya se
  reemplazaron en las 6 páginas que los tenían). Se atiende a mano desde
  la app de WhatsApp Business (ver nota de más arriba, el número ya no
  está en la API).
- El contenido de las páginas de curso (temario, etc.) **se queda igual**
  — el cambio fue solo de CTAs y quitar la captura de leads, no de
  contenido.

Cambios concretos:
- `index.html`: nav sin "Contacto"; CTA del header y del hero pasan de
  "Quiero información" → "Apartar mi lugar" (`cursos/inscripcion.html`);
  debajo de los botones del hero, un link discreto a WhatsApp; se quitó
  por completo la sección `<section class="lead" id="contacto">` (el
  formulario); footer con el WhatsApp real + link a "Apartar mi lugar"
  en vez de los 2 teléfonos viejos + "Solicitar información".
- `cursos/excel.html`, `sql-server.html`, `power-bi.html`, `python.html`
  (las 4 son idénticas en estructura, se tocaron con un script): mismo
  cambio de nav/CTA; en la tarjeta de precio del sidebar, el botón
  secundario "Solicitar información" se reemplazó por "¿Dudas? Escríbenos
  por WhatsApp" (va directo a `wa.me` con el curso precargado en el
  mensaje); se quitó la sección de leads completa; mismo fix de footer.
- `cursos/inscripcion.html`: no tenía formulario de leads, solo se le
  corrigió el footer (mismo fix de teléfonos).
- `assets/js/app.js`: se eliminó `initLeadForm()` completa y su llamada
  en `DOMContentLoaded`, junto con las constantes `LEADS_ENDPOINT` y
  `GRACIAS_URL` que ya no se usaban. `PHONE_LEN` se queda — lo sigue
  usando el formulario de inscripción (el campo de WhatsApp ahí es
  opcional/informativo, ver nota de "Channel logic" en `CLAUDE.md`).
- `gracias.html` queda **huérfana** (nadie la enlaza ya, era el destino
  del formulario que se quitó) — se dejó el archivo tal cual, sin
  borrarlo, solo ya no es alcanzable navegando el sitio.
- CSS de `.lead`/`.lead-grid`/`.lead-copy`/`.form-card` en
  `styles.css` quedó sin usarse (no se tocó, es inofensivo dejarlo).
- Probado visualmente con Puppeteer (`file://`, sin necesitar el backend
  — son cambios solo de frontend) antes de desplegar.

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
