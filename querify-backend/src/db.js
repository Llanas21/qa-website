// src/db.js — configuración central + acceso a PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const num = (k, d) => { const v = parseFloat(env(k)); return Number.isFinite(v) ? v : d; };
const bool = (k, d) => { const v = env(k).toLowerCase(); return v ? v === 'true' || v === '1' : d; };

const config = {
  port: num('PORT', 3000),
  corsOrigins: env('CORS_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
  staticDir: env('STATIC_DIR'),
  databaseUrl: env('DATABASE_URL'),

  session: { secret: env('SESSION_SECRET', 'dev-secret-cambiar') },
  admin: { user: env('ADMIN_USER', 'admin'), passHash: env('ADMIN_PASS_HASH') },

  whatsapp: {
    token: env('WHATSAPP_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    apiVersion: env('WHATSAPP_API_VERSION', 'v21.0'),
    lang: env('WHATSAPP_TEMPLATE_LANG', 'es_MX'),
    templates: {
      pago: env('TPL_PAGO', 'querify_pago'),
      inscripcion: env('TPL_INSCRIPCION', 'querify_inscripcion'),
    },
  },

  // Correo se envía vía Microsoft Graph (ver providers.js), como el buzón
  // compartido indicado aquí. Debe ser solo la dirección, sin "Nombre <...>":
  // el nombre para mostrar lo controla el propio buzón en Microsoft 365.
  email: {
    from: env('MAIL_FROM', 'noreply@QuerifyAnalytics.onmicrosoft.com'),
  },

  graph: {
    tenantId: env('GRAPH_TENANT_ID'), clientId: env('GRAPH_CLIENT_ID'),
    clientSecret: env('GRAPH_CLIENT_SECRET'),
  },

  // Recordatorios de cada grupo en el calendario de Outlook (ver
  // calendario.js). Se crean en cada buzón de la lista (separados por coma)
  // con la misma app de Graph que el correo — requiere el permiso de
  // aplicación Calendars.ReadWrite. Sin buzones (o sin Graph) se simula.
  calendario: {
    buzones: env('CALENDARIO_BUZONES').split(',').map(s => s.trim()).filter(Boolean),
    hora: env('CALENDARIO_HORA', '10:00'),          // hora del aviso, hora del centro de México
    zona: env('CALENDARIO_ZONA', 'Central Standard Time (Mexico)'), // nombre de Windows: el que Graph acepta siempre
  },

  // Stripe Checkout para el apartado de lugar (pago 1) y los pagos 2-5.
  // Si falta STRIPE_SECRET_KEY, toda la inscripción corre en modo simulación.
  stripe: {
    secretKey: env('STRIPE_SECRET_KEY'),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
    currency: env('STRIPE_CURRENCY', 'mxn'),
  },

  // Plan de pagos: 5 exhibiciones de $500 MXN (semanas 0/2/4/6/8 desde el
  // inicio de la cohorte). La ventana de cobro es cuántos días antes del
  // vencimiento se manda el link de pago por WhatsApp/correo.
  pagos: {
    monto: num('PAGO_MONTO_MXN', 500),
    ventanaCobroDias: num('PAGOS_VENTANA_COBRO_DIAS', 3),
  },

  // Si se define, se usa como origen absoluto para las URLs de éxito/cancelado
  // de Stripe en vez de derivarlo de la petición (útil detrás de proxies raros).
  publicBaseUrl: env('PUBLIC_BASE_URL'),

  // Chrome con el que se convierte la plantilla HTML del certificado a PDF.
  // Vacío = el Chrome empaquetado de @sparticuz/chromium (solo Linux, es lo
  // que usa Railway). En Windows/macOS para desarrollo local hay que apuntarlo
  // al Chrome instalado, ej. C:\Program Files\Google\Chrome\Application\chrome.exe
  chromePath: env('CHROME_PATH'),

  // Cron horario: recordatorios de pago 2-5 y calendario de Outlook.
  cron: env('CRON_SCHEDULE', '0 * * * *'),

  // Interruptor general: pausa los recordatorios de pago 2-5 automáticos sin tocar
  // credenciales ni desmontar nada. NO pausa la confirmación de inscripción al
  // pagar: esa es un recibo transaccional de un pago real, no seguimiento proactivo.
  automatizacionPausada: bool('AUTOMATIZACION_PAUSADA', false),
};

// Flags de modo simulación (si faltan credenciales, no se envía nada real)
const graphReady = !!(config.graph.tenantId && config.graph.clientId && config.graph.clientSecret);
config.simulate = {
  whatsapp: !(config.whatsapp.token && config.whatsapp.phoneNumberId),
  email: !graphReady,
  calendario: !(graphReady && config.calendario.buzones.length),
  stripe: !config.stripe.secretKey,
};

const pool = new Pool({
  connectionString: config.databaseUrl || undefined,
  // Muchos proveedores (Railway/Render) requieren SSL en producción:
  ssl: /sslmode=require/.test(config.databaseUrl) || env('PGSSL') === 'true'
    ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

module.exports = { config, pool, query };