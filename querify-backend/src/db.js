// src/db.js — configuración central + acceso a PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const num = (k, d) => { const v = parseFloat(env(k)); return Number.isFinite(v) ? v : d; };

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
    verifyToken: env('WHATSAPP_VERIFY_TOKEN', 'querify-verify'),
    lang: env('WHATSAPP_TEMPLATE_LANG', 'es_MX'),
    templates: {
      bienvenida: env('TPL_BIENVENIDA', 'querify_bienvenida'),
      recordatorio: env('TPL_RECORDATORIO', 'querify_recordatorio'),
      valor: env('TPL_VALOR', 'querify_valor'),
      cierre: env('TPL_CIERRE', 'querify_cierre'),
      pago: env('TPL_PAGO', 'querify_pago'),
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
    clientSecret: env('GRAPH_CLIENT_SECRET'), driveId: env('GRAPH_DRIVE_ID'),
    workbookItemId: env('GRAPH_WORKBOOK_ITEM_ID'), tableName: env('GRAPH_TABLE_NAME', 'Prospectos'),
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

  seq: {
    step1: num('SEQ_STEP1_HOURS', 24),
    step2: num('SEQ_STEP2_HOURS', 72),
    step3: num('SEQ_STEP3_HOURS', 168),
    dedupResetDays: num('DEDUP_RESET_DAYS', 14),
    cron: env('CRON_SCHEDULE', '0 * * * *'),
  },
};

// Flags de modo simulación (si faltan credenciales, no se envía nada real)
const graphReady = !!(config.graph.tenantId && config.graph.clientId && config.graph.clientSecret);
config.simulate = {
  whatsapp: !(config.whatsapp.token && config.whatsapp.phoneNumberId),
  email: !graphReady,
  sync: !(graphReady && config.graph.workbookItemId),
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