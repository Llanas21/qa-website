// scripts/db-init.js — crea las tablas y siembra las fechas (idempotente)
// Uso:  npm run db:init
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/db');

(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await query(schema);
    const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    await query(seed);
    console.log('✓ Base de datos inicializada (tablas + 8 fechas de inicio).');
  } catch (err) {
    console.error('✗ Error al inicializar la base:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
