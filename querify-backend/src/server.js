// src/server.js — arranque de la aplicación
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cron = require('node-cron');

const { config, pool, query } = require('./db');
const publicRoutes = require('./routes');
const admin = require('./admin');
const engine = require('./engine');

const app = express();
app.set('trust proxy', 1); // detrás de proxy (Railway/Render) para cookies seguras

// CORS: si defines CORS_ORIGINS se restringe a esos; si no, se refleja el origen.
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 },
}));

app.get('/health', (req, res) => res.json({ ok: true, simulate: config.simulate }));

// Rutas públicas (formulario + webhook) y panel
app.use('/', publicRoutes);
app.use('/admin', admin.router);

// Servir el sitio estático desde aquí (opcional) — se monta al final
if (config.staticDir) {
  const dir = path.resolve(__dirname, '..', config.staticDir);
  if (fs.existsSync(dir)) {
    app.use('/', express.static(dir));
    console.info(`[static] sirviendo el sitio desde ${dir}`);
  } else {
    console.warn(`[static] STATIC_DIR no existe: ${dir} (se ignora)`);
  }
}

/* -------- inicialización idempotente de la base de datos -------- */
async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await query(schema);
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM fechas_inicio`);
  if (rows[0].n === 0) {
    const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    await query(seed);
    console.info('[db] fechas_inicio sembradas (8 filas).');
  }
  console.info('[db] esquema listo.');
}

async function main() {
  try {
    await initDb();
  } catch (err) {
    console.error('[db] no se pudo inicializar. ¿DATABASE_URL correcto y Postgres arriba?');
    console.error('     ', err.message);
    process.exit(1);
  }

  // Motor de la secuencia
  cron.schedule(config.seq.cron, () => {
    engine.correrSecuencia().catch(e => console.error('[cron]', e.message));
  });

  const modo = Object.entries(config.simulate).filter(([, v]) => v).map(([k]) => k);
  app.listen(config.port, () => {
    console.info(`\n  Querify backend en http://localhost:${config.port}`);
    console.info(`  Panel:  http://localhost:${config.port}/admin`);
    console.info(`  Cron:   "${config.seq.cron}"  (recordatorio ${config.seq.step1}h · valor ${config.seq.step2}h · cierre ${config.seq.step3}h)`);
    console.info(`  Simulación activa en: ${modo.length ? modo.join(', ') : 'ninguno (todo real)'}\n`);
  });
}

process.on('SIGTERM', () => pool.end().then(() => process.exit(0)));
main();
