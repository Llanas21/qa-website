// src/calendario.js — recordatorios de cada grupo en el calendario de Outlook
// (28 oct 2026). Una sola lista de recordatorios para todos los cursos
// (tabla `recordatorios`, editable en /admin/recordatorios); por cada grupo
// con fecha de inicio se crea un evento por recordatorio en cada buzón de
// CALENDARIO_BUZONES. Se crean también los que ya pasaron (pedido del
// usuario: si da de alta un grupo tarde, ve lo que ya debía estar hecho).
//
// Cada cambio (fecha, días o fin del grupo, o la lista de recordatorios)
// marca el grupo con `calendario_pendiente`, y sincronizarPendientes() lo
// pone al día: crea lo que falta, mueve lo que cambió y borra lo que sobra.
// Corre al guardar, al arrancar el servidor y en el cron horario (reintento
// si Graph falló).
const crypto = require('crypto');
const { config, query } = require('./db');
const providers = require('./providers');

const PREFIJO = { 'Excel': 'EXCEL', 'SQL Server': 'SQL', 'Power BI': 'POWERBI', 'Python': 'PYTHON' };
const DIAS_VALIDOS = ['LM', 'MJ', 'SAB'];

/* ----------------------------- fechas (sin zona) ----------------------------- */
// Las columnas DATE llegan de pg como medianoche local; se leen con getters
// locales y se opera en UTC para no depender de la zona del proceso.
function ymd(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function sumarDias(fecha, n) {
  const [y, m, d] = ymd(fecha).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}
function diasEntre(a, b) {
  const t = f => { const [y, m, d] = ymd(f).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/* ------------------------------- nombre y fechas ------------------------------- */
// Días por default de un grupo nuevo (lo que el usuario manejaba fijo antes
// de que existiera el campo): sabatino SAB; entre semana Excel/Python LM y
// SQL Server/Power BI MJ.
function diasPorDefecto(curso, modalidad) {
  if (modalidad === 'sabatino') return 'SAB';
  return ['Excel', 'Python'].includes(curso) ? 'LM' : 'MJ';
}

// Último día por default: 10 semanas. Sabatino = el sábado de la semana 10
// (+63 días); entre semana = el segundo día de clase de la semana 10 (+65).
function fechaFinPorDefecto(fechaInicio, dias) {
  return fechaInicio ? sumarDias(fechaInicio, dias === 'SAB' ? 63 : 65) : null;
}

// Nomenclatura del usuario: CURSO-DIAS-MMYY (mes y año de inicio), ej. EXCEL-SAB-1026.
function codigoGrupo(c) {
  if (!c.fecha_inicio) return null;
  const [y, m] = ymd(c.fecha_inicio).split('-');
  const dias = c.dias || diasPorDefecto(c.curso, c.modalidad);
  return `${PREFIJO[c.curso] || c.curso.toUpperCase().replace(/\s+/g, '')}-${dias}-${m}${y.slice(2)}`;
}

/* ---------------------------------- eventos ---------------------------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtLargo = f => new Date(`${ymd(f)}T12:00:00Z`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Fechas del recordatorio para un grupo: [desde, hasta] (hasta = null si es de un día).
function fechasDe(c, rec) {
  const base = rec.ancla === 'fin' ? ymd(c.fecha_fin) || fechaFinPorDefecto(c.fecha_inicio, c.dias) : ymd(c.fecha_inicio);
  let a = rec.dia_desde, b = rec.dia_hasta;
  if (b == null || b === a) return [sumarDias(base, a), null];
  if (b < a) [a, b] = [b, a];
  return [sumarDias(base, a), sumarDias(base, b)];
}

// Evento de Graph. De un día: a la hora configurada (10:00), con aviso en
// ese momento. De varios días: evento de todo el día que cruza el rango
// (opción elegida por el usuario), con aviso a la misma hora del día
// anterior — Outlook cuenta el aviso desde la medianoche del primer día.
function eventoPara(c, rec) {
  const [desde, hasta] = fechasDe(c, rec);
  const codigo = codigoGrupo(c);
  const [h, m] = config.calendario.hora.split(':').map(Number);
  const zona = config.calendario.zona;
  const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
  const inicioMin = h * 60 + (m || 0);

  const enlace = `${config.publicBaseUrl || `http://localhost:${config.port}`}/admin/grupo/${c.id}`;
  const cuerpo = [
    rec.notas ? `<p>${esc(rec.notas)}</p>` : '',
    `<p><b>Grupo:</b> ${esc(codigo)} — ${esc(c.curso)} (${c.modalidad === 'sabatino' ? 'sabatino' : 'entre semana'})<br>`,
    `<b>Primera clase:</b> ${esc(fmtLargo(c.fecha_inicio))}<br>`,
    `<b>Última clase:</b> ${esc(fmtLargo(c.fecha_fin || fechaFinPorDefecto(c.fecha_inicio, c.dias)))}</p>`,
    `<p><a href="${esc(enlace)}">Ver el grupo y sus alumnos en el panel</a></p>`,
  ].join('');

  const comun = {
    subject: `${codigo} · ${rec.titulo}`,
    body: { contentType: 'HTML', content: cuerpo },
    showAs: 'free', isReminderOn: true,
  };
  if (!hasta) {
    return { ...comun, isAllDay: false, reminderMinutesBeforeStart: 0,
      start: { dateTime: `${desde}T${hhmm(inicioMin)}`, timeZone: zona },
      end: { dateTime: `${desde}T${hhmm(inicioMin + 30)}`, timeZone: zona } };
  }
  return { ...comun, isAllDay: true, reminderMinutesBeforeStart: 24 * 60 - inicioMin,
    start: { dateTime: `${desde}T00:00:00`, timeZone: zona },
    end: { dateTime: `${sumarDias(hasta, 1)}T00:00:00`, timeZone: zona } };
}

const firmaDe = ev => crypto.createHash('sha1').update(JSON.stringify(ev)).digest('hex');

/* ------------------------------- sincronización ------------------------------- */
// Todo en una sola fila: dos sincronizaciones al mismo tiempo (guardar +
// cron) crearían eventos duplicados.
let cola = Promise.resolve();
const enCola = fn => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };
let ultimoError = null; // { mensaje, fecha } — se muestra en el panel

async function sincronizarCohorte(cohorteId) {
  const c = (await query(`SELECT * FROM cohortes WHERE id = $1`, [cohorteId])).rows[0];
  if (!c) return;
  const recs = c.fecha_inicio ? (await query(`SELECT * FROM recordatorios ORDER BY orden, id`)).rows : [];
  const filas = (await query(`SELECT * FROM cohorte_eventos WHERE cohorte_id = $1`, [cohorteId])).rows;
  const existentes = new Map(filas.map(f => [`${f.recordatorio_id}|${f.buzon}`, f]));
  const cuenta = { creados: 0, actualizados: 0, borrados: 0, errores: 0 };
  // Sin permiso (401/403) fallaría igual cada evento: se corta todo y se
  // reintenta en la siguiente hora, en vez de intentar cientos de llamadas.
  const fallo = (r) => {
    cuenta.errores++; ultimoError = { mensaje: r.error, fecha: new Date() };
    console.error(`[calendario] grupo #${cohorteId}: ${r.error}`);
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`sin permiso en Outlook: ${r.error}`), { sinPermiso: true });
  };

  const deseados = new Set();
  for (const buzon of config.calendario.buzones) {
    for (const rec of recs) {
      const clave = `${rec.id}|${buzon}`;
      deseados.add(clave);
      const ev = eventoPara(c, rec);
      const firma = firmaDe(ev);
      const fila = existentes.get(clave);
      if (fila && fila.firma === firma) continue;

      if (fila) {
        const r = await providers.actualizarEventoCalendario(buzon, fila.event_id, ev);
        if (r.ok) { await query(`UPDATE cohorte_eventos SET firma = $2 WHERE id = $1`, [fila.id, firma]); cuenta.actualizados++; continue; }
        if (!r.noExiste) { fallo(r); continue; }
        // Lo borraron a mano en Outlook: se vuelve a crear abajo.
      }
      const r = await providers.crearEventoCalendario(buzon, ev);
      if (!r.ok) { fallo(r); continue; }
      await query(
        `INSERT INTO cohorte_eventos (cohorte_id, recordatorio_id, buzon, event_id, firma) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (cohorte_id, recordatorio_id, buzon) DO UPDATE SET event_id = EXCLUDED.event_id, firma = EXCLUDED.firma`,
        [cohorteId, rec.id, buzon, r.id, firma]);
      cuenta.creados++;
    }
  }

  // Sobran: recordatorio borrado, buzón quitado de la lista o grupo sin fecha.
  for (const f of filas) {
    if (deseados.has(`${f.recordatorio_id}|${f.buzon}`)) continue;
    const r = await providers.borrarEventoCalendario(f.buzon, f.event_id);
    if (!r.ok) { fallo(r); continue; }
    await query(`DELETE FROM cohorte_eventos WHERE id = $1`, [f.id]);
    cuenta.borrados++;
  }

  await query(`UPDATE cohortes SET calendario_pendiente = $2 WHERE id = $1`, [cohorteId, cuenta.errores > 0]);
  if (cuenta.creados || cuenta.actualizados || cuenta.borrados) {
    console.info(`[calendario${config.simulate.calendario ? ' SIMULADO' : ''}] ${codigoGrupo(c) || `grupo #${cohorteId}`}: ` +
      `${cuenta.creados} creado(s), ${cuenta.actualizados} movido(s), ${cuenta.borrados} borrado(s)${cuenta.errores ? `, ${cuenta.errores} error(es)` : ''}`);
  }
  return cuenta;
}

// Sin buzones configurados no se hace nada (ni se borra): los grupos se
// quedan pendientes para cuando se configure CALENDARIO_BUZONES.
function sincronizarPendientes() {
  if (!config.calendario.buzones.length) return Promise.resolve();
  return enCola(async () => {
    const { rows } = await query(`SELECT id FROM cohortes WHERE calendario_pendiente ORDER BY fecha_inicio NULLS FIRST, id`);
    try {
      for (const { id } of rows) await sincronizarCohorte(id);
    } catch (err) {
      if (!err.sinPermiso) throw err;
      console.error(`[calendario] ${err.message} — se reintenta en la siguiente hora`);
      return;
    }
    if (rows.length && !(await contarPendientes())) ultimoError = null;
  });
}

// Marca grupos para sincronizar y arranca sin esperar (el panel no se
// queda colgado mientras Graph crea decenas de eventos).
async function marcarPendientes(ids = null) {
  if (ids) await query(`UPDATE cohortes SET calendario_pendiente = true WHERE id = ANY($1)`, [ids]);
  else await query(`UPDATE cohortes SET calendario_pendiente = true WHERE fecha_inicio IS NOT NULL OR id IN (SELECT cohorte_id FROM cohorte_eventos)`);
  sincronizarPendientes().catch(e => console.error('[calendario]', e.message));
}

async function contarPendientes() {
  return (await query(`SELECT COUNT(*)::int AS n FROM cohortes WHERE calendario_pendiente AND (fecha_inicio IS NOT NULL OR id IN (SELECT cohorte_id FROM cohorte_eventos))`)).rows[0].n;
}

// Para el aviso de estado en el panel.
async function estado() {
  return {
    buzones: config.calendario.buzones,
    simulado: config.simulate.calendario,
    pendientes: await contarPendientes(),
    ultimoError,
  };
}

module.exports = {
  DIAS_VALIDOS, ymd, sumarDias, diasEntre, diasPorDefecto, fechaFinPorDefecto, codigoGrupo, fechasDe, eventoPara,
  sincronizarPendientes, marcarPendientes, estado,
};
