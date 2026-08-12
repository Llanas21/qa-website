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

// Igual que registrarMensaje, pero para el timeline de un alumno (recordatorios
// de pago) en vez de un prospecto — son líneas independientes en `mensajes`.
async function registrarMensajeAlumno(alumnoId, { tipo, canal, estado, contenido = null, error = null }) {
  await query(
    `INSERT INTO mensajes (alumno_id, tipo, canal, estado, contenido, error)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [alumnoId, tipo, canal, estado, contenido, error]
  );
}

// Próxima fecha de inicio del curso (la más cercana futura entre sus cohortes/modalidades)
async function proximaFecha(curso) {
  const { rows } = await query(
    `SELECT fecha_inicio FROM cohortes
     WHERE curso = $1 AND fecha_inicio IS NOT NULL AND fecha_inicio >= CURRENT_DATE
     ORDER BY fecha_inicio ASC LIMIT 1`, [curso]
  );
  if (!rows[0]) return null;
  return new Date(rows[0].fecha_inicio).toLocaleDateString('es-MX',
    { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ------------------- envío con canal + respaldo ------------------- */
// Mecanismo base: intenta WhatsApp y, si falla y hay correo, respalda por correo.
// `onLog` registra cada intento en el timeline correcto (prospecto o alumno).
async function enviarConVars({ pais, numero, correo, canal, tipo, vars, onLog }) {
  const { cuerpo } = tpl.render(tipo, vars);

  if (canal === 'whatsapp' && numero) {
    const r = await providers.sendWhatsAppTemplate({ pais, numero, tipo, vars });
    await onLog({ tipo, canal: 'whatsapp', estado: r.estado, contenido: cuerpo, error: r.error });
    if (r.ok) return true;
    // Respaldo por correo si el WhatsApp falló y dejó correo
    if (correo) {
      const r2 = await providers.sendEmail({ to: correo, tipo, vars });
      await onLog({ tipo, canal: 'correo', estado: r2.estado, contenido: cuerpo, error: r2.error });
      return r2.ok;
    }
    return false;
  }

  // Canal correo (no dejó WhatsApp) o sin teléfono
  if (correo) {
    const r = await providers.sendEmail({ to: correo, tipo, vars });
    await onLog({ tipo, canal: 'correo', estado: r.estado, contenido: cuerpo, error: r.error });
    return r.ok;
  }
  return false;
}

// Envía un mensaje de la secuencia a un prospecto (bienvenida/recordatorio/valor/cierre).
// Misma lógica de siempre — solo se extrajo a enviarConVars() para poder reutilizarla
// también en el cobro de pagos (ver enviarLinkPago), sin duplicar el canal WhatsApp→correo.
async function enviar(p, tipo) {
  const fecha = tipo === 'valor' ? (await proximaFecha(p.curso)) || 'muy pronto' : '';
  const vars = [p.nombre, p.curso, fecha];
  return enviarConVars({
    pais: p.telefono_pais, numero: p.telefono, correo: p.correo, canal: p.canal, tipo, vars,
    onLog: (m) => registrarMensaje(p.id, m),
  });
}

// Envía la liga de pago (Stripe Checkout) de un pago 2-5 a un alumno.
async function enviarLinkPago(alumno, pago, url) {
  const vars = [alumno.nombre, alumno.curso, pago.numero_pago, Math.round(Number(pago.monto)), url];
  return enviarConVars({
    pais: alumno.whatsapp_pais, numero: alumno.whatsapp, correo: alumno.correo,
    canal: alumno.whatsapp ? 'whatsapp' : 'correo', tipo: 'pago', vars,
    onLog: (m) => registrarMensajeAlumno(alumno.id, m),
  });
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

/* ------------------- inscripción, cohortes y pagos ------------------- */
const PLAN_PAGOS = 5;                     // 5 exhibiciones
const SEMANAS_PAGO = [0, 2, 4, 6, 8];     // semana relativa al inicio de la cohorte, por pago 1-5

// Cohortes de un curso con cupo disponible (para el selector del sitio).
async function cohortesDisponibles(curso) {
  const { rows } = await query(
    `SELECT id, curso, modalidad, fecha_inicio, cupo_maximo, lugares_ocupados,
            (cupo_maximo - lugares_ocupados) AS lugares_disponibles
     FROM cohortes
     WHERE curso = $1 AND fecha_inicio IS NOT NULL AND fecha_inicio >= CURRENT_DATE
       AND lugares_ocupados < cupo_maximo
     ORDER BY fecha_inicio ASC`, [curso]);
  return rows;
}

async function cohortePorId(id) {
  const { rows } = await query(`SELECT * FROM cohortes WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Origen público del backend, para armar las URLs de éxito/cancelado de Stripe
// cuando no hay un `req` a mano (el cron corre en segundo plano). En las rutas
// (POST /api/inscripcion) se prefiere derivarlo de la petición; PUBLIC_BASE_URL
// es el respaldo para contextos sin request, como este.
function baseUrl() {
  return config.publicBaseUrl || `http://localhost:${config.port}`;
}

// Arranca la inscripción: valida cupo y crea la Checkout Session del pago 1.
// El alumno NO se crea aquí (eso ocurre al confirmar el webhook) — este check
// de cupo es solo para no generar un link de pago si la cohorte ya está llena
// en este instante; la ocupación real y autoritativa del cupo pasa en
// confirmarInscripcion(), al confirmarse el pago.
async function iniciarInscripcion({ cohorteId, nombre, whatsapp, correo, prospectoId, urlExito, urlCancelado }) {
  const cohorte = await cohortePorId(cohorteId);
  if (!cohorte) return { ok: false, motivo: 'cohorte_no_existe' };
  if (cohorte.lugares_ocupados >= cohorte.cupo_maximo) return { ok: false, motivo: 'sin_cupo' };

  const r = await providers.crearCheckoutSession({
    descripcion: `Pago 1/5 — curso de ${cohorte.curso} (apartado de lugar)`,
    monto: config.pagos.monto,
    metadata: {
      tipo: 'inscripcion', cohorte_id: String(cohorteId), nombre,
      whatsapp_pais: whatsapp?.pais || '', whatsapp: whatsapp?.numero || '',
      correo: correo || '', prospecto_id: prospectoId ? String(prospectoId) : '',
    },
    urlExito, urlCancelado,
  });
  if (!r.ok) return { ok: false, motivo: 'error_stripe', error: r.error };

  if (r.simulado) {
    // Sin credenciales reales de Stripe: se completa la inscripción de una vez,
    // igual que el resto del sistema simula un envío exitoso sin cuenta externa.
    const alumno = await confirmarInscripcion({
      cohorteId, nombre, whatsapp, correo, prospectoId,
      stripeSessionId: r.sessionId, stripePaymentIntentId: null,
    });
    return { ok: true, simulado: true, alumno };
  }
  return { ok: true, simulado: false, url: r.url };
}

// Confirma el pago 1: crea al alumno, genera los 5 pagos programados (el 1 ya
// 'pagado') y ocupa el cupo de la cohorte. Idempotente por stripe_session_id,
// para no duplicar el alta si Stripe reenvía el mismo webhook.
async function confirmarInscripcion({ cohorteId, nombre, whatsapp, correo, prospectoId, stripeSessionId, stripePaymentIntentId }) {
  if (stripeSessionId) {
    const existe = await query(
      `SELECT a.* FROM alumnos a JOIN pagos p ON p.alumno_id = a.id
       WHERE p.stripe_session_id = $1 LIMIT 1`, [stripeSessionId]);
    if (existe.rows[0]) return existe.rows[0];
  }

  const cohorte = await cohortePorId(cohorteId);
  if (!cohorte) throw new Error(`cohorte #${cohorteId} no existe`);

  const { rows: [alumno] } = await query(
    `INSERT INTO alumnos (prospecto_id, cohorte_id, nombre, whatsapp_pais, whatsapp, correo)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [prospectoId || null, cohorteId, nombre, whatsapp?.pais || null, whatsapp?.numero || null, correo || null]);

  // Se ancla a medianoche UTC del día calendario de la cohorte (leído con
  // getters locales, como lo construye pg-types) y desde ahí se suman
  // milisegundos exactos — así el cálculo no depende de la zona horaria
  // del proceso (evita que un TZ adelantado a UTC recorra la fecha un día).
  const base = new Date(cohorte.fecha_inicio);
  const baseUTC = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  for (let n = 1; n <= PLAN_PAGOS; n++) {
    const venc = new Date(baseUTC + SEMANAS_PAGO[n - 1] * 7 * 24 * HORA);
    const esPago1 = n === 1;
    await query(
      `INSERT INTO pagos (alumno_id, numero_pago, monto, fecha_vencimiento, estado, metodo, stripe_session_id, stripe_payment_intent_id, fecha_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [alumno.id, n, config.pagos.monto, venc.toISOString().slice(0, 10),
        esPago1 ? 'pagado' : 'pendiente', esPago1 ? 'stripe' : null,
        esPago1 ? stripeSessionId : null, esPago1 ? stripePaymentIntentId : null,
        esPago1 ? new Date() : null]);
  }

  await query(`UPDATE cohortes SET lugares_ocupados = lugares_ocupados + 1 WHERE id = $1`, [cohorteId]);
  await registrarMensajeAlumno(alumno.id, {
    tipo: 'pago', canal: 'sistema', estado: 'nota',
    contenido: `Inscripción confirmada. Pago 1/5 recibido, lugar apartado en la cohorte #${cohorteId}.`,
  });
  return alumno;
}

// Confirma un pago 2-5 ya generado (webhook de Stripe o marcado manual desde el panel).
async function confirmarPago({ pagoId, metodo = 'stripe', stripeSessionId = null, stripePaymentIntentId = null }) {
  const { rows } = await query(
    `UPDATE pagos SET estado = 'pagado', metodo = $2,
       stripe_session_id = COALESCE($3, stripe_session_id),
       stripe_payment_intent_id = COALESCE($4, stripe_payment_intent_id),
       fecha_pago = now()
     WHERE id = $1 AND estado <> 'pagado' RETURNING *`,
    [pagoId, metodo, stripeSessionId, stripePaymentIntentId]);
  const pago = rows[0];
  if (pago) {
    await registrarMensajeAlumno(pago.alumno_id, {
      tipo: 'pago', canal: 'sistema', estado: 'nota',
      contenido: `Pago ${pago.numero_pago}/5 marcado como pagado (${metodo}).`,
    });
  }
  return pago;
}

// Punto de entrada del webhook de Stripe: decide si el checkout.session.completed
// corresponde al pago 1 (inscripción) o a uno de los pagos 2-5.
async function procesarWebhookStripe(session) {
  const meta = session.metadata || {};
  if (meta.tipo === 'inscripcion') {
    await confirmarInscripcion({
      cohorteId: Number(meta.cohorte_id), nombre: meta.nombre,
      whatsapp: meta.whatsapp ? { pais: meta.whatsapp_pais, numero: meta.whatsapp } : null,
      correo: meta.correo || null, prospectoId: meta.prospecto_id ? Number(meta.prospecto_id) : null,
      stripeSessionId: session.id, stripePaymentIntentId: session.payment_intent || null,
    });
  } else if (meta.tipo === 'pago' && meta.pago_id) {
    await confirmarPago({
      pagoId: Number(meta.pago_id), metodo: 'stripe',
      stripeSessionId: session.id, stripePaymentIntentId: session.payment_intent || null,
    });
  }
}

// Cron (además de correrSecuencia): por cada pago 2-5 pendiente/vencido que esté
// por vencer dentro de la ventana configurada, genera su Checkout Session (si no
// se ha reenviado el link en las últimas ~20h) y la manda por WhatsApp→correo.
async function revisarPagosPorVencer() {
  await query(`UPDATE pagos SET estado = 'vencido' WHERE estado = 'pendiente' AND fecha_vencimiento < CURRENT_DATE`);

  const { rows } = await query(
    `SELECT p.*, a.nombre, a.whatsapp_pais, a.whatsapp, a.correo, c.curso
     FROM pagos p
     JOIN alumnos  a ON a.id = p.alumno_id
     JOIN cohortes c ON c.id = a.cohorte_id
     WHERE p.estado IN ('pendiente', 'vencido') AND p.numero_pago > 1
       AND p.fecha_vencimiento <= (CURRENT_DATE + $1::int)
       AND (p.fecha_recordatorio_enviado IS NULL OR p.fecha_recordatorio_enviado < now() - interval '20 hours')
     ORDER BY p.fecha_vencimiento ASC`,
    [config.pagos.ventanaCobroDias]);

  let enviados = 0;
  for (const p of rows) {
    const alumno = { id: p.alumno_id, nombre: p.nombre, whatsapp_pais: p.whatsapp_pais, whatsapp: p.whatsapp, correo: p.correo, curso: p.curso };

    const r = await providers.crearCheckoutSession({
      descripcion: `Pago ${p.numero_pago}/5 — curso de ${p.curso}`,
      monto: Number(p.monto),
      metadata: { tipo: 'pago', pago_id: String(p.id) },
      urlExito: `${baseUrl()}/inscripcion-gracias.html?pago=${p.numero_pago}`,
      urlCancelado: `${baseUrl()}/admin`,
    });
    if (!r.ok) { console.error(`[pagos] no se pudo crear checkout para pago #${p.id}: ${r.error}`); continue; }

    await query(`UPDATE pagos SET fecha_recordatorio_enviado = now(), stripe_session_id = COALESCE($2, stripe_session_id) WHERE id = $1`, [p.id, r.sessionId]);

    if (r.simulado) {
      // Sin Stripe real no hay link que mandar: se deja registro en el timeline
      // (igual que WhatsApp/correo simulan el envío) pero el pago sigue pendiente
      // — se marca pagado desde /admin/alumnos con el botón manual, como en producción
      // cuando alguien transfiere fuera de Stripe.
      await registrarMensajeAlumno(p.alumno_id, {
        tipo: 'pago', canal: alumno.whatsapp ? 'whatsapp' : 'correo', estado: 'simulado',
        contenido: `[SIMULADO] Liga de pago ${p.numero_pago}/5 ($${p.monto} MXN) — sin credenciales de Stripe.`,
      });
      enviados++;
      continue;
    }

    const ok = await enviarLinkPago(alumno, p, r.url);
    if (ok) enviados++;
  }
  if (enviados) console.info(`[pagos] ${enviados} recordatorio(s) de pago procesado(s)`);
  return enviados;
}

module.exports = {
  altaProspecto, afterIntake, correrSecuencia, registrarMensaje, proximaFecha,
  cohortesDisponibles, cohortePorId, iniciarInscripcion, confirmarInscripcion,
  confirmarPago, procesarWebhookStripe, revisarPagosPorVencer,
};
