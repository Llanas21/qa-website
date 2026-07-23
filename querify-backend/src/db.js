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
    },
  },

  email: {
    host: env('SMTP_HOST'), port: num('SMTP_PORT', 587),
    user: env('SMTP_USER'), pass: env('SMTP_PASS'),
    from: env('MAIL_FROM', 'Querify Analytics <no-responder@example.com>'),
  },

  graph: {
    tenantId: env('GRAPH_TENANT_ID'), clientId: env('GRAPH_CLIENT_ID'),
    clientSecret: env('GRAPH_CLIENT_SECRET'), driveId: env('GRAPH_DRIVE_ID'),
    workbookItemId: env('GRAPH_WORKBOOK_ITEM_ID'), tableName: env('GRAPH_TABLE_NAME', 'Prospectos'),
  },

  seq: {
    step1: num('SEQ_STEP1_HOURS', 24),
    step2: num('SEQ_STEP2_HOURS', 72),
    step3: num('SEQ_STEP3_HOURS', 168),
    dedupResetDays: num('DEDUP_RESET_DAYS', 14),
    cron: env('CRON_SCHEDULE', '0 * * * *'),
  },
};

// Flags de modo simulación (si faltan credenciales, no se envía nada real)
config.simulate = {
  whatsapp: !(config.whatsapp.token && config.whatsapp.phoneNumberId),
  email: !(config.email.host && config.email.user),
  sync: !(config.graph.tenantId && config.graph.clientId && config.graph.clientSecret && config.graph.workbookItemId),
};

const pool = new Pool({
  connectionString: config.databaseUrl || undefined,
  // Muchos proveedores (Railway/Render) requieren SSL en producción:
  ssl: /sslmode=require/.test(config.databaseUrl) || env('PGSSL') === 'true'
    ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

module.exports = { config, pool, query };
