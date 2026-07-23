// src/engine.js — lógica de negocio: canal, deduplicado, alta y secuencia
const { config, query } = require('./db');
const providers = require('./providers');
const tpl = require('./templates');

const HORA = 3600 * 1000;
const OFFSET = { 0: config.seq.step1, 1: config.seq.step2, 2: config.seq.step3 }; // horas desde inicio de secuencia
const STEP_MSG = { 0: 'recordatorio', 1: 'valor', 2: 'cierre' }; // qué mensaje toca según paso actual

/* ---------------------------- utilidades ---------------------------- */
async function registrarMensaje(prospectoId, { tipo, canal, estado, contenido = null, error = null }) {
  await query(
    `INSERT INTO mensajes (prospecto_id, tipo, canal, estado, contenido, error)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [prospectoId, tipo, canal, estado, contenido, error]
  );
}

// Próxima fecha de inicio del curso (la más cercana futura entre sus modalidades)
async function proximaFecha(curso) {
  const { rows } = await query(
    `SELECT fecha FROM fechas_inicio
     WHERE curso = $1 AND fecha IS NOT NULL AND fecha >= CURRENT_DATE
     ORDER BY fecha ASC LIMIT 1`, [curso]
  );
  if (!rows[0]) return null;
  return new Date(rows[0].fecha).toLocaleDateString('es-MX',
    { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ------------------- envío con canal + respaldo ------------------- */
// Envía un mensaje a un prospecto. WhatsApp principal; si falla y hay correo, respalda por correo.
async function enviar(p, tipo) {
  const fecha = tipo === 'valor' ? (await proximaFecha(p.curso)) || 'muy pronto' : '';
  const vars = [p.nombre, p.curso, fecha];
  const { cuerpo } = tpl.render(tipo, vars);

  if (p.canal === 'whatsapp' && p.telefono) {
    const r = await providers.sendWhatsAppTemplate({ pais: p.telefono_pais, numero: p.telefono, tipo, vars });
    await registrarMensaje(p.id, { tipo, canal: 'whatsapp', estado: r.estado, contenido: cuerpo, error: r.error });
    if (r.ok) return true;
    // Respaldo por correo si el WhatsApp falló y dejó correo
    if (p.correo) {
      const r2 = await providers.sendEmail({ to: p.correo, tipo, vars });
      await registrarMensaje(p.id, { tipo, canal: 'correo', estado: r2.estado, contenido: cuerpo, error: r2.error });
      return r2.ok;
    }
    return false;
  }

  // Canal correo (no dejó WhatsApp) o sin teléfono
  if (p.correo) {
    const r = await providers.sendEmail({ to: p.correo, tipo, vars });
    await registrarMensaje(p.id, { tipo, canal: 'correo', estado: r.estado, contenido: cuerpo, error: r.error });
    return r.ok;
  }
  return false;
}

async function tocarUltimoMensaje(id) {
  await query(`UPDATE prospectos SET fecha_ultimo_mensaje = now() WHERE id = $1`, [id]);
}

/* ------------------- deduplicado + alta ------------------- */
async function buscarExistente({ pais, numero, correo }) {
  const cond = [], params = [];
  if (numero) { params.push(pais, numero); cond.push(`(telefono_pais = $${params.length - 1} AND telefono = $${params.length})`); }
  if (correo) { params.push(correo); cond.push(`correo = $${params.length}`); }
  if (!cond.length) return null;
  const { rows } = await query(
    `SELECT * FROM prospectos WHERE ${cond.join(' OR ')} ORDER BY id DESC LIMIT 1`, params);
  return rows[0] || null;
}

function canalDe(numero) { return numero ? 'whatsapp' : 'correo'; }

// Alta o actualización según reglas del brief. NO envía nada (eso lo hace afterIntake).
async function altaProspecto(data) {
  const pais = data.whatsapp?.pais || null;
  const numero = data.whatsapp?.numero || null;
  const correo = data.correo || null;
  const curso = data.curso || 'Aún no decido';
  const nombre = data.nombre;

  const existente = await buscarExistente({ pais, numero, correo });

  if (existente) {
    const hitos = [existente.fecha_registro, existente.fecha_ultimo_mensaje, existente.fecha_ultimo_entrante]
      .filter(Boolean).map(d => new Date(d).getTime());
    const ultimo = Math.max(...hitos);
    const dias = (Date.now() - ultimo) / (24 * HORA);

    if (dias < config.seq.dedupResetDays) {
      // Reciente: solo actualiza curso y rellena datos faltantes; NO reinicia secuencia.
      const { rows } = await query(
        `UPDATE prospectos SET
           curso = $2,
           telefono_pais = COALESCE(telefono_pais, $3),
           telefono      = COALESCE(telefono, $4),
           correo        = COALESCE(correo, $5),
           canal         = CASE WHEN telefono IS NOT NULL OR $4 IS NOT NULL THEN 'whatsapp' ELSE 'correo' END
         WHERE id = $1 RETURNING *`,
        [existente.id, curso, pais, numero, correo]);
      return { action: 'actualizado', prospecto: rows[0] };
    }

    // Frío que volvió (>= N días): actualiza datos y REINICIA la secuencia desde el paso 0.
    const { rows } = await query(
      `UPDATE prospectos SET
         nombre = $2, curso = $3, telefono_pais = $4, telefono = $5, correo = $6,
         canal = $7, estado_secuencia = 'activa', paso_actual = 0,
         fecha_inicio_secuencia = now(), fecha_ultimo_mensaje = NULL
       WHERE id = $1 RETURNING *`,
      [existente.id, nombre, curso, pais, numero, correo, canalDe(numero)]);
    return { action: 'reiniciado', prospecto: rows[0] };
  }

  // Nuevo prospecto
  const { rows } = await query(
    `INSERT INTO prospectos (nombre, curso, telefono_pais, telefono, correo, canal, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [nombre, curso, pais, numero, correo, canalDe(numero), data.origen || 'sitio_web']);
  return { action: 'creado', prospecto: rows[0] };
}

// En segundo plano tras responder al formulario: bienvenida + sync a SharePoint.
async function afterIntake(prospecto, action) {
  try {
    if (action === 'creado' || action === 'reiniciado') {
      const ok = await enviar(prospecto, 'bienvenida');
      if (ok) await tocarUltimoMensaje(prospecto.id);
      await providers.syncProspecto(prospecto);
    }
  } catch (err) {
    console.error('[afterIntake] error:', err.message);
  }
}

/* ------------------- motor de la secuencia (cron) ------------------- */
async function correrSecuencia() {
  const { rows } = await query(`SELECT * FROM prospectos WHERE estado_secuencia = 'activa'`);
  let enviados = 0;
  for (const p of rows) {
    const paso = p.paso_actual;
    if (paso >= 3) {
      await query(`UPDATE prospectos SET estado_secuencia='finalizada' WHERE id=$1`, [p.id]);
      continue;
    }
    const due = new Date(p.fecha_inicio_secuencia).getTime() + OFFSET[paso] * HORA;
    if (Date.now() < due) continue;

    const tipo = STEP_MSG[paso];
    await enviar(p, tipo);                       // el resultado (incluido fallo) queda en el timeline
    const nuevoPaso = paso + 1;
    await query(
      `UPDATE prospectos SET paso_actual=$2, fecha_ultimo_mensaje=now(),
         estado_secuencia = CASE WHEN $2 >= 3 THEN 'finalizada' ELSE 'activa' END
       WHERE id=$1`, [p.id, nuevoPaso]);
    enviados++;
  }
  if (enviados) console.info(`[secuencia] ${enviados} mensaje(s) procesado(s)`);
  return enviados;
}

module.exports = { altaProspecto, afterIntake, correrSecuencia, registrarMensaje, proximaFecha };
