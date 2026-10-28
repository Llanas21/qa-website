// src/engine.js — lógica de negocio: canal, deduplicado, alta y secuencia
const crypto = require('crypto');
const { config, query } = require('./db');
const providers = require('./providers');
const tpl = require('./templates');
const calendario = require('./calendario');

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
  // Las plantillas dicen literal "el curso de {{2}}" — con "Aún no decido"
  // (el valor real que se guarda en prospectos.curso) se leería "el curso de
  // Aún no decido". Solo para el texto del mensaje se usa un valor que sí
  // encaja en esa frase; en la base y en /admin se sigue viendo "Aún no decido".
  const cursoMsg = p.curso === 'Aún no decido' ? 'Análisis de Datos' : p.curso;
  const vars = [p.nombre, cursoMsg, fecha];
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
    canal: 'correo', tipo: 'pago', vars,
    onLog: (m) => registrarMensajeAlumno(alumno.id, m),
  });
}

async function tocarUltimoMensaje(id) {
  await query(`UPDATE prospectos SET fecha_ultimo_mensaje = now() WHERE id = $1`, [id]);
}

// Respuesta manual del operador desde el panel admin (texto libre, no plantilla).
// Solo WhatsApp por ahora — requiere que el prospecto tenga teléfono, y WhatsApp
// solo entrega texto libre dentro de las 24h después de su último mensaje entrante
// (si no, Meta rechaza y el error queda en el timeline tal cual lo manda Meta).
async function responderManual(prospecto, texto) {
  if (!prospecto.telefono) return { ok: false, error: 'Este prospecto no dejó WhatsApp.' };
  const r = await providers.sendWhatsAppTexto({ pais: prospecto.telefono_pais, numero: prospecto.telefono, texto });
  await registrarMensaje(prospecto.id, { tipo: 'manual', canal: 'whatsapp', estado: r.estado, contenido: texto, error: r.error });
  if (r.ok) await tocarUltimoMensaje(prospecto.id);
  return r;
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

// A partir del 1 oct 2026 el sitio solo maneja correo — el número real salió
// de la API (se migró a la app de WhatsApp Business, ver ESTADO.md). Se deja
// la lógica de WhatsApp intacta en enviarConVars/providers por si algún día
// se reconecta un número; aquí simplemente ya no se elige nunca ese canal.
function canalDe(numero) { return 'correo'; }

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
           canal         = 'correo'
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
      if (config.automatizacionPausada) {
        await registrarMensaje(prospecto.id, { tipo: 'sistema', canal: 'sistema', estado: 'nota', contenido: 'Bienvenida NO mandada: automatización pausada.' });
        return;
      }
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
  if (config.automatizacionPausada) return 0;
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
  if (!cohorte || !cohorte.fecha_inicio) return { ok: false, motivo: 'cohorte_no_existe' };
  if (cohorte.lugares_ocupados >= cohorte.cupo_maximo) return { ok: false, motivo: 'sin_cupo' };

  // Cliente de Stripe (uno por correo) para que la página de pago ofrezca
  // también transferencia a su CLABE fija. Si abrió antes otro pago de
  // inscripción por transferencia y no lo pagó, se cancela: si no, ese pago
  // viejo se quedaría con su transferencia en vez de este. Si algo de esto
  // falla, se sigue solo con tarjeta en vez de no dejarlo pagar.
  let customerId = null;
  if (!config.simulate.stripe) {
    try {
      customerId = await providers.clienteStripe({ nombre, correo });
      await providers.cancelarTransferenciasAbiertas(customerId, m => m.tipo === 'inscripcion');
    } catch (err) {
      console.error('[inscripcion] sin opción de transferencia:', err.message);
      customerId = null;
    }
  }

  const r = await providers.crearCheckoutSession({
    descripcion: `Pago 1/5 — curso de ${cohorte.curso} (apartado de lugar)`,
    monto: config.pagos.monto,
    metadata: {
      tipo: 'inscripcion', cohorte_id: String(cohorteId), nombre,
      whatsapp_pais: whatsapp?.pais || '', whatsapp: whatsapp?.numero || '',
      correo: correo || '', prospecto_id: prospectoId ? String(prospectoId) : '',
    },
    urlExito, urlCancelado, customerId,
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
async function confirmarInscripcion({ cohorteId, nombre, whatsapp, correo, prospectoId, stripeSessionId, stripePaymentIntentId, stripeCustomerId = null, metodo = 'stripe', enviarBienvenida = true }) {
  if (stripeSessionId) {
    const existe = await query(
      `SELECT a.* FROM alumnos a JOIN pagos p ON p.alumno_id = a.id
       WHERE p.stripe_session_id = $1 LIMIT 1`, [stripeSessionId]);
    if (existe.rows[0]) return existe.rows[0];
  }

  const cohorte = await cohortePorId(cohorteId);
  if (!cohorte) throw new Error(`cohorte #${cohorteId} no existe`);

  const { rows: [alumno] } = await query(
    `INSERT INTO alumnos (prospecto_id, cohorte_id, nombre, whatsapp_pais, whatsapp, correo, stripe_customer_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [prospectoId || null, cohorteId, nombre, whatsapp?.pais || null, whatsapp?.numero || null, correo || null, stripeCustomerId]);

  // Su CLABE fija (la misma que vio si pagó por transferencia) para la
  // tarjeta "Transferencia" del panel. No es indispensable: si falla, se
  // obtiene después con "Generar CLABE".
  if (stripeCustomerId) {
    try {
      const d = await providers.datosTransferencia(stripeCustomerId);
      await query(`UPDATE alumnos SET clabe = $2, clabe_banco = $3, clabe_titular = $4 WHERE id = $1`,
        [alumno.id, d.clabe, d.banco, d.titular]);
    } catch (err) { console.error(`[inscripcion] no se pudo leer la CLABE de ${stripeCustomerId}: ${err.message}`); }
  }

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
        esPago1 ? 'pagado' : 'pendiente', esPago1 ? metodo : null,
        esPago1 ? stripeSessionId : null, esPago1 ? stripePaymentIntentId : null,
        esPago1 ? new Date() : null]);
  }

  await query(`UPDATE cohortes SET lugares_ocupados = lugares_ocupados + 1 WHERE id = $1`, [cohorteId]);
  await registrarMensajeAlumno(alumno.id, {
    tipo: 'pago', canal: 'sistema', estado: 'nota',
    contenido: `Inscripción confirmada (método: ${metodo}). Pago 1/5 recibido, lugar apartado en la cohorte #${cohorteId}.`,
  });

  // Confirmación real al alumno (WhatsApp→correo, igual que el resto del
  // sistema) — antes solo quedaba la nota interna de arriba y nunca se le
  // avisaba de verdad que su lugar quedó apartado. El alta manual puede
  // apagarlo (ej. registrar a alguien de un grupo que ya va a la mitad).
  if (enviarBienvenida) {
    const vars = [alumno.nombre, cohorte.curso];
    await enviarConVars({
      pais: alumno.whatsapp_pais, numero: alumno.whatsapp, correo: alumno.correo,
      canal: 'correo', tipo: 'inscripcion', vars,
      onLog: (m) => registrarMensajeAlumno(alumno.id, m),
    });
  }

  return alumno;
}

// Alta manual de un alumno desde el panel admin — para quien pagó por
// transferencia u otro medio fuera de Stripe. Mismo resultado final que el
// flujo normal (iniciarInscripcion + webhook): el pago 1 queda 'pagado' con
// método 'manual', se generan los 5 pagos, se ocupa el cupo y entra igual al
// flujo automático de recordatorios de los pagos 2-5 — solo que sin pasar
// por Stripe para el pago 1. Valida cupo igual que iniciarInscripcion, para
// no dar de alta a alguien en una cohorte ya llena por accidente.
async function altaAlumnoManual({ cohorteId, nombre, whatsapp, correo, enviarBienvenida = true }) {
  const cohorte = await cohortePorId(cohorteId);
  if (!cohorte) return { ok: false, motivo: 'cohorte_no_existe' };
  // El plan de pagos se calcula desde fecha_inicio; sin ella, new Date(null)
  // da 1970 y los pagos 2-5 quedan vencidos de inmediato (pasó en producción).
  if (!cohorte.fecha_inicio) return { ok: false, motivo: 'sin_fecha' };
  if (cohorte.lugares_ocupados >= cohorte.cupo_maximo) return { ok: false, motivo: 'sin_cupo' };
  const alumno = await confirmarInscripcion({ cohorteId, nombre, whatsapp, correo, metodo: 'manual', enviarBienvenida });
  return { ok: true, alumno };
}

// Alta de un grupo nuevo desde Cohortes. Los días y el último día tienen
// default (ver calendario.js) si no se mandan.
async function crearCohorte({ curso, modalidad, dias, fechaInicio, fechaFin, cupo }) {
  const d = modalidad === 'sabatino' ? 'SAB' : (['LM', 'MJ'].includes(dias) ? dias : calendario.diasPorDefecto(curso, modalidad));
  const fin = fechaInicio ? (fechaFin || calendario.fechaFinPorDefecto(fechaInicio, d)) : null;
  if (fin && fechaInicio && fin < fechaInicio) return { ok: false, error: 'El último día no puede ser antes del inicio.' };
  const { rows } = await query(
    `INSERT INTO cohortes (curso, modalidad, dias, fecha_inicio, fecha_fin, cupo_maximo) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (curso, modalidad, dias, fecha_inicio) DO NOTHING RETURNING id`,
    [curso, modalidad, d, fechaInicio || null, fin, cupo]);
  if (!rows[0]) return { ok: false, error: 'Ya existe ese grupo (mismo curso, días y fecha de inicio).' };
  await calendario.marcarPendientes([rows[0].id]);
  return { ok: true, id: rows[0].id };
}

// Edita un grupo desde Cohortes (solo los campos que se manden). Si cambia
// la fecha de inicio: el último día se recorre lo mismo (salvo que también
// lo hayan cambiado a mano), se recalculan los pagos pendientes de sus
// alumnos y se mueven sus recordatorios del calendario.
async function actualizarCohorte(id, { fechaInicio, fechaFin, dias, cupo }) {
  const c = (await query(`SELECT * FROM cohortes WHERE id = $1`, [id])).rows[0];
  if (!c) return { ok: false, error: 'El grupo no existe.' };
  const viejoInicio = calendario.ymd(c.fecha_inicio), viejoFin = calendario.ymd(c.fecha_fin);
  const inicio = fechaInicio !== undefined ? (fechaInicio || null) : viejoInicio;
  const d = c.modalidad === 'sabatino' ? 'SAB' : (['LM', 'MJ'].includes(dias) ? dias : (c.dias || calendario.diasPorDefecto(c.curso, c.modalidad)));
  let fin = fechaFin !== undefined ? (fechaFin || null) : viejoFin;
  const cambioInicio = inicio !== viejoInicio;
  const tocoFin = fin !== viejoFin;

  if (!inicio) fin = null;
  else if (cambioInicio && !tocoFin) fin = viejoInicio && viejoFin
    ? calendario.sumarDias(viejoFin, calendario.diasEntre(viejoInicio, inicio))
    : calendario.fechaFinPorDefecto(inicio, d);
  else if (!fin) fin = calendario.fechaFinPorDefecto(inicio, d);
  if (inicio && fin < inicio) return { ok: false, error: `${calendario.codigoGrupo({ ...c, fecha_inicio: inicio, dias: d })}: el último día no puede ser antes del inicio.` };

  const nuevoCupo = Number.isInteger(cupo) && cupo > 0 ? cupo : c.cupo_maximo;
  try {
    await query(`UPDATE cohortes SET fecha_inicio = $2, fecha_fin = $3, dias = $4, cupo_maximo = $5 WHERE id = $1`,
      [id, inicio, fin, d, nuevoCupo]);
  } catch (err) {
    if (err.code === '23505') return { ok: false, error: `Ya existe otro grupo de ${c.curso} con esos días y esa fecha de inicio.` };
    throw err;
  }
  if (cambioInicio && inicio) await recalcularPagosCohorte(id, inicio);
  if (cambioInicio || fin !== viejoFin || d !== c.dias) await calendario.marcarPendientes([id]);
  return { ok: true };
}

// Recalcula las fechas de los pagos que aún no se pagan (pendiente/vencido)
// de todos los alumnos del grupo, desde su nueva fecha de inicio — mismas
// semanas que al darlos de alta (SEMANAS_PAGO). Los pagados no se tocan.
async function recalcularPagosCohorte(cohorteId, fechaInicio) {
  const { rows } = await query(
    `UPDATE pagos p SET
       fecha_vencimiento = $2::date + ($3::int[])[p.numero_pago] * 7,
       estado = CASE WHEN $2::date + ($3::int[])[p.numero_pago] * 7 < CURRENT_DATE THEN 'vencido' ELSE 'pendiente' END
     FROM alumnos a
     WHERE p.alumno_id = a.id AND a.cohorte_id = $1 AND p.estado IN ('pendiente', 'vencido')
     RETURNING p.alumno_id`, [cohorteId, fechaInicio, SEMANAS_PAGO]);
  for (const alumnoId of new Set(rows.map(r => r.alumno_id))) {
    await registrarMensajeAlumno(alumnoId, {
      tipo: 'sistema', canal: 'sistema', estado: 'nota',
      contenido: `La fecha de inicio del grupo cambió al ${fechaInicio}: se recalcularon las fechas de sus pagos pendientes.`,
    });
  }
  return rows.length;
}

// Baja de un alumno que dejó el curso: libera su lugar en el cupo, cancela
// sus pagos pendientes/vencidos (ya no se cobran ni cuentan como adeudo) y
// lo marca con fecha_baja. No se borra nada: su historial y los pagos que sí
// hizo se conservan. El WHERE fecha_baja IS NULL evita liberar el cupo dos
// veces si se envía dos veces.
async function darDeBaja(alumnoId) {
  const { rows } = await query(
    `UPDATE alumnos SET fecha_baja = now() WHERE id = $1 AND fecha_baja IS NULL RETURNING cohorte_id`, [alumnoId]);
  if (!rows[0]) return { ok: false };
  const cancelados = (await query(
    `UPDATE pagos SET estado = 'cancelado' WHERE alumno_id = $1 AND estado IN ('pendiente', 'vencido')`, [alumnoId])).rowCount;
  await query(`UPDATE cohortes SET lugares_ocupados = GREATEST(lugares_ocupados - 1, 0) WHERE id = $1`, [rows[0].cohorte_id]);
  await registrarMensajeAlumno(alumnoId, {
    tipo: 'sistema', canal: 'sistema', estado: 'nota',
    contenido: `Dado de baja desde el panel: ${cancelados} pago(s) pendiente(s) cancelado(s) y su lugar liberado.`,
  });
  return { ok: true };
}

// Sube (o reemplaza) el PDF del certificado de un alumno y genera un token
// aleatorio nuevo para la liga pública de descarga (/certificados/:token,
// ver routes.js) — el token no es el id del alumno a propósito, para que
// la liga no sea adivinable por alguien más.
async function subirCertificado({ alumnoId, buffer, nombreArchivo }) {
  const token = crypto.randomBytes(20).toString('hex');
  const { rows } = await query(
    `UPDATE alumnos SET certificado_pdf = $2, certificado_nombre = $3,
       certificado_token = $4, certificado_subido_en = now()
     WHERE id = $1 RETURNING id, certificado_token`,
    [alumnoId, buffer, nombreArchivo, token]);
  return rows[0] || null;
}

// Manda el correo de "tu certificado ya está listo" con la liga de descarga
// pública — requiere haber subido el PDF antes con subirCertificado().
async function enviarCertificado(alumnoId) {
  const { rows } = await query(
    `SELECT a.*, c.curso FROM alumnos a JOIN cohortes c ON c.id = a.cohorte_id WHERE a.id = $1`,
    [alumnoId]);
  const alumno = rows[0];
  if (!alumno) return { ok: false, motivo: 'alumno_no_existe' };
  if (!alumno.certificado_token) return { ok: false, motivo: 'sin_certificado' };
  if (!alumno.correo) return { ok: false, motivo: 'sin_correo' };

  const link = `${baseUrl()}/certificados/${alumno.certificado_token}`;
  const ok = await enviarConVars({
    pais: alumno.whatsapp_pais, numero: alumno.whatsapp, correo: alumno.correo,
    canal: 'correo', tipo: 'certificado', vars: [alumno.nombre, alumno.curso, link],
    onLog: (m) => registrarMensajeAlumno(alumnoId, m),
  });
  return { ok };
}

// Confirma un pago 2-5 ya generado (webhook de Stripe, transferencia o marcado manual desde el panel).
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
    // Si para este mismo pago dejó abierta una transferencia (eligió
    // "transferencia" en una liga y luego pagó por otra vía), se cancela:
    // si no, se quedaría con su siguiente transferencia como pago de algo
    // que ya está cubierto.
    const { rows: [a] } = await query(`SELECT stripe_customer_id FROM alumnos WHERE id = $1`, [pago.alumno_id]);
    if (a?.stripe_customer_id && !config.simulate.stripe) {
      await providers.cancelarTransferenciasAbiertas(a.stripe_customer_id, m => m.pago_id === String(pago.id))
        .catch(err => console.error(`[pago] no se pudieron revisar transferencias abiertas: ${err.message}`));
    }
  }
  return pago;
}

// Asigna al alumno su CLABE fija para transferencias (un Customer de Stripe
// con instrucciones SPEI). Si ya tiene una, la regresa tal cual: la CLABE
// es permanente y es la que el alumno guarda en su banco.
async function generarClabe(alumnoId) {
  const { rows } = await query(`SELECT * FROM alumnos WHERE id = $1`, [alumnoId]);
  const alumno = rows[0];
  if (!alumno) return { ok: false, error: 'El alumno no existe.' };
  if (alumno.clabe) return { ok: true, alumno };
  const r = await providers.crearClabe({ nombre: alumno.nombre, correo: alumno.correo });
  if (!r.ok) return r;
  const upd = await query(
    `UPDATE alumnos SET stripe_customer_id = $2, clabe = $3, clabe_banco = $4, clabe_titular = $5
     WHERE id = $1 RETURNING *`, [alumnoId, r.customerId, r.clabe, r.banco, r.titular]);
  await registrarMensajeAlumno(alumnoId, {
    tipo: 'sistema', canal: 'sistema', estado: 'nota', contenido: `CLABE para transferencias asignada: ${r.clabe}.`,
  });
  return { ok: true, alumno: upd.rows[0] };
}

// Llegó una transferencia a la CLABE de un alumno (webhook
// customer_cash_balance_transaction.created). Si tiene un pago abierto por
// transferencia (lo eligió en la página de pago), Stripe se lo aplica solo
// y avisa con checkout.session.async_payment_succeeded — aquí no se hace
// nada. Si transfirió directo a su CLABE, con el saldo que tenga se cubren
// sus pagos pendientes en orden mientras alcance; lo que sobre se queda
// como saldo a favor para la siguiente.
// Las llamadas por cliente se encadenan para que dos webhooks seguidos no
// cobren el mismo saldo dos veces.
const colaTransferencias = new Map();
function procesarTransferencia(customerId) {
  const previa = colaTransferencias.get(customerId) || Promise.resolve();
  const actual = previa.catch(() => {}).then(() => aplicarSaldo(customerId));
  colaTransferencias.set(customerId, actual);
  actual.finally(() => { if (colaTransferencias.get(customerId) === actual) colaTransferencias.delete(customerId); }).catch(() => {});
  return actual;
}

async function aplicarSaldo(customerId) {
  // Todavía no es alumno (pagó la inscripción por transferencia y el alta
  // llega con async_payment_succeeded) — nada que hacer aquí.
  const { rows: alumnos } = await query(
    `SELECT * FROM alumnos WHERE stripe_customer_id = $1 AND fecha_baja IS NULL ORDER BY id`, [customerId]);
  if (!alumnos.length) return { aplicados: 0 };
  if ((await providers.transferenciasAbiertas(customerId)).length) return { aplicados: 0 };

  let saldo = await providers.saldoTransferencias(customerId);
  if (saldo <= 0) return { aplicados: 0 };
  const pendientes = (await query(
    `SELECT * FROM pagos WHERE alumno_id = ANY($1) AND estado IN ('pendiente', 'vencido')
     ORDER BY fecha_vencimiento, numero_pago`, [alumnos.map(a => a.id)])).rows;

  let aplicados = 0;
  for (const p of pendientes) {
    const monto = Number(p.monto);
    if (saldo < monto) break;
    const r = await providers.cobrarDeSaldo({
      customerId, monto, descripcion: `Pago ${p.numero_pago}/5 — transferencia`,
      metadata: { tipo: 'transferencia', pago_id: String(p.id) },
    });
    if (!r.ok) { console.error(`[transferencia] no se pudo aplicar al pago #${p.id}: ${r.error}`); break; }
    await confirmarPago({ pagoId: p.id, metodo: 'transferencia', stripePaymentIntentId: r.paymentIntentId });
    saldo -= monto;
    aplicados++;
  }

  if (saldo > 0) {
    await registrarMensajeAlumno(alumnos[alumnos.length - 1].id, {
      tipo: 'pago', canal: 'sistema', estado: 'nota',
      contenido: pendientes.length > aplicados
        ? `Transferencia recibida: queda un saldo a favor de $${saldo} MXN, no alcanza para el siguiente pago. Se aplicará cuando complete el monto.`
        : `Transferencia recibida: queda un saldo a favor de $${saldo} MXN y ya no tiene pagos pendientes.`,
    });
  }
  return { aplicados, saldo };
}

// Eligió "transferencia" en la página de pago: Stripe no cobra nada todavía,
// solo le muestra sus datos. Se los mandamos también por correo para que no
// dependa de esa pantalla (puede cerrarla y transferir horas después).
async function enviarDatosTransferencia(session) {
  const meta = session.metadata || {};
  let est;
  try { est = await providers.estadoCheckout(session.id); }
  catch (err) { console.error(`[transferencia] no se pudo leer la sesión ${session.id}: ${err.message}`); return; }
  if (!est.transferencia) return;

  let destino;
  if (meta.tipo === 'inscripcion') {
    const cohorte = await cohortePorId(Number(meta.cohorte_id));
    destino = { nombre: meta.nombre, correo: meta.correo, curso: cohorte?.curso || '', concepto: 'pago 1 de 5, con el que apartas tu lugar', alumnoId: null };
  } else if (meta.tipo === 'pago' && meta.pago_id) {
    const { rows: [p] } = await query(
      `SELECT p.numero_pago, a.id AS alumno_id, a.nombre, a.correo, c.curso FROM pagos p
       JOIN alumnos a ON a.id = p.alumno_id JOIN cohortes c ON c.id = a.cohorte_id WHERE p.id = $1`, [Number(meta.pago_id)]);
    if (!p) return;
    destino = { nombre: p.nombre, correo: p.correo, curso: p.curso, concepto: `pago ${p.numero_pago} de 5`, alumnoId: p.alumno_id };
  } else return;

  const t = est.transferencia;
  await enviarConVars({
    correo: destino.correo, canal: 'correo', tipo: 'transferencia',
    vars: [destino.nombre, destino.curso, destino.concepto, Math.round(t.monto), t.clabe, t.banco, t.titular, t.url],
    onLog: (m) => destino.alumnoId ? registrarMensajeAlumno(destino.alumnoId, m)
      : (m.estado === 'fallido' ? console.error(`[transferencia] correo a ${destino.correo} falló: ${m.error}`) : null),
  });
}

// Punto de entrada del webhook de Stripe:
// - checkout.session.completed: pagó con tarjeta (payment_status 'paid') o
//   eligió transferencia y aún no paga ('unpaid' → se le mandan los datos).
// - checkout.session.async_payment_succeeded: llegó esa transferencia.
// En los dos casos de pago se decide si es el pago 1 (inscripción) o un 2-5.
async function procesarWebhookStripe(session, tipoEvento = 'checkout.session.completed') {
  const esTransferencia = tipoEvento === 'checkout.session.async_payment_succeeded';
  if (!esTransferencia && session.payment_status !== 'paid') return enviarDatosTransferencia(session);

  const meta = session.metadata || {};
  const metodo = esTransferencia ? 'transferencia' : 'stripe';
  if (meta.tipo === 'inscripcion') {
    await confirmarInscripcion({
      cohorteId: Number(meta.cohorte_id), nombre: meta.nombre,
      whatsapp: meta.whatsapp ? { pais: meta.whatsapp_pais, numero: meta.whatsapp } : null,
      correo: meta.correo || null, prospectoId: meta.prospecto_id ? Number(meta.prospecto_id) : null,
      stripeSessionId: session.id, stripePaymentIntentId: session.payment_intent || null,
      stripeCustomerId: session.customer || null, metodo,
    });
  } else if (meta.tipo === 'pago' && meta.pago_id) {
    const pago = await confirmarPago({
      pagoId: Number(meta.pago_id), metodo,
      stripeSessionId: session.id, stripePaymentIntentId: session.payment_intent || null,
    });
    if (!pago) {
      // Ya estaba pagado por otra vía: es un cobro doble, hay que revisarlo a mano.
      const { rows: [p] } = await query(`SELECT alumno_id, numero_pago FROM pagos WHERE id = $1`, [Number(meta.pago_id)]);
      if (p) await registrarMensajeAlumno(p.alumno_id, {
        tipo: 'pago', canal: 'sistema', estado: 'nota',
        contenido: `⚠ Llegó otro pago (${metodo}) del pago ${p.numero_pago}/5, que ya estaba pagado. Revisa en Stripe si hay que reembolsarlo (${session.payment_intent || session.id}).`,
      });
    }
  }
}

// Cron (además de correrSecuencia): por cada pago 2-5 pendiente/vencido que esté
// por vencer dentro de la ventana configurada, genera su Checkout Session (si no
// se ha reenviado el link en las últimas ~20h) y la manda por WhatsApp→correo.
async function revisarPagosPorVencer() {
  // Marcar vencido es solo estatus (no manda nada) — corre siempre, aunque la
  // automatización esté pausada, para que el panel admin refleje la realidad.
  await query(`UPDATE pagos SET estado = 'vencido' WHERE estado = 'pendiente' AND fecha_vencimiento < CURRENT_DATE`);
  if (config.automatizacionPausada) return 0;

  const { rows } = await query(
    `SELECT p.*, a.nombre, a.whatsapp_pais, a.whatsapp, a.correo, a.stripe_customer_id, c.curso
     FROM pagos p
     JOIN alumnos  a ON a.id = p.alumno_id
     JOIN cohortes c ON c.id = a.cohorte_id
     WHERE p.estado IN ('pendiente', 'vencido') AND p.numero_pago > 1
       AND NOT a.archivado AND a.fecha_baja IS NULL
       -- Pagos que ya estaban vencidos al darlo de alta (alta manual en un
       -- grupo ya empezado) no se cobran solos: se registran a mano en el
       -- panel. Sin esto, el alumno recibía cobros de pagos que muy
       -- probablemente ya hizo, minutos después del alta.
       AND p.fecha_vencimiento >= a.fecha_alta::date
       AND p.fecha_vencimiento <= (CURRENT_DATE + $1::int)
       AND (p.fecha_recordatorio_enviado IS NULL OR p.fecha_recordatorio_enviado < now() - interval '20 hours')
     ORDER BY p.fecha_vencimiento ASC`,
    [config.pagos.ventanaCobroDias]);

  let enviados = 0;
  for (const p of rows) {
    const alumno = { id: p.alumno_id, nombre: p.nombre, whatsapp_pais: p.whatsapp_pais, whatsapp: p.whatsapp, correo: p.correo, curso: p.curso };

    // Alumnos que no pasaron por la página de pago (alta manual, o inscritos
    // antes de que hubiera transferencia) no tienen cliente de Stripe: se le
    // asigna su CLABE aquí para que la liga ofrezca también transferencia.
    let customerId = p.stripe_customer_id;
    if (!customerId && !config.simulate.stripe) {
      const g = await generarClabe(p.alumno_id);
      customerId = g.ok ? g.alumno.stripe_customer_id : null;
    }

    const r = await providers.crearCheckoutSession({
      descripcion: `Pago ${p.numero_pago}/5 — curso de ${p.curso}`,
      monto: Number(p.monto),
      metadata: { tipo: 'pago', pago_id: String(p.id) },
      urlExito: `${baseUrl()}/inscripcion-gracias.html?pago=${p.numero_pago}`,
      urlCancelado: `${baseUrl()}/admin`,
      customerId,
    });
    if (!r.ok) { console.error(`[pagos] no se pudo crear checkout para pago #${p.id}: ${r.error}`); continue; }

    await query(`UPDATE pagos SET fecha_recordatorio_enviado = now(), stripe_session_id = COALESCE($2, stripe_session_id) WHERE id = $1`, [p.id, r.sessionId]);

    if (r.simulado) {
      // Sin Stripe real no hay link que mandar: se deja registro en el timeline
      // (igual que WhatsApp/correo simulan el envío) pero el pago sigue pendiente
      // — se marca pagado desde /admin/alumnos con el botón manual, como en producción
      // cuando alguien transfiere fuera de Stripe.
      await registrarMensajeAlumno(p.alumno_id, {
        tipo: 'pago', canal: 'correo', estado: 'simulado',
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
  altaProspecto, afterIntake, correrSecuencia, registrarMensaje, registrarMensajeAlumno, proximaFecha,
  cohortesDisponibles, cohortePorId, iniciarInscripcion, confirmarInscripcion, altaAlumnoManual,
  confirmarPago, procesarWebhookStripe, revisarPagosPorVencer, responderManual,
  subirCertificado, enviarCertificado, darDeBaja, generarClabe, procesarTransferencia,
  crearCohorte, actualizarCohorte, recalcularPagosCohorte,
};
