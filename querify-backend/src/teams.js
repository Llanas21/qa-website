// src/teams.js — canal privado de Teams de cada grupo, con sus alumnos como invitados
//
// Estructura del dueño: un equipo por curso y año ("SQL SERVER 2026", lo crea
// él a mano una vez al año) con un canal PRIVADO por grupo, nombrado con los
// días y el mes/año de inicio ("SAB-1126"). El día antes del inicio a las
// 3:00 pm (TEAMS_HORA_CANAL, hora del centro de México) se crea el canal, con
// TEAMS_PROPIETARIOS como propietarios, y se invita a los alumnos inscritos
// como invitados de la organización: primero al equipo (Teams lo exige para
// entrar a un canal privado) y luego al canal. Quien paga después se agrega
// en cuanto se confirma su pago. Un alumno puede tener varios correos de
// Teams (tabla alumno_teams): si luego usa otro, se agrega también y conviven.
// Baja = se le saca del canal; cambio de grupo = de un canal al otro. Al
// terminar el curso no se toca nada. El material y el diseño del sitio de
// cada canal siguen siendo a mano.
//
// Todo pasa por sincronizar(): compara lo que debería haber con lo ya hecho y
// hace solo lo que falta, en una cola (nunca dos a la vez). Corre en el cron
// de cada hora, al arrancar y después de inscribir/editar/dar de baja. Lo que
// falla se guarda (cohortes.teams_error / alumno_teams.error), se muestra en
// el panel y se reintenta en la siguiente vuelta.
const { config, query } = require('./db');
const providers = require('./providers');
const calendario = require('./calendario');

const DIAS_LABEL = { LM: 'lunes y miércoles', MJ: 'martes y jueves', SAB: 'sábados' };

const activo = () => config.teams.propietarios.length > 0;
const nombreEquipo = c => `${c.curso.toUpperCase()} ${calendario.ymd(c.fecha_inicio).slice(0, 4)}`;
// Código del grupo sin el prefijo del curso: EXCEL-SAB-1126 → SAB-1126.
const nombreCanal = c => calendario.codigoGrupo(c).split('-').slice(1).join('-');

// El día antes del inicio a la hora configurada. El centro de México es
// UTC-6 todo el año (sin horario de verano desde 2022).
function momentoCanal(c) {
  const dia = calendario.sumarDias(c.fecha_inicio, -1);
  return new Date(`${dia}T${String(config.teams.horaCanal).padStart(2, '0')}:00:00-06:00`);
}

const exigir = r => { if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`); return r; };
const nota = (alumnoId, contenido) => query(
  `INSERT INTO mensajes (alumno_id, tipo, canal, estado, contenido) VALUES ($1, 'sistema', 'sistema', 'nota', $2)`,
  [alumnoId, contenido]);

let propietarioIds = null;
async function idsPropietarios() {
  if (propietarioIds) return propietarioIds;
  const ids = [];
  for (const correo of config.teams.propietarios) {
    const r = exigir(await providers.usuarioPorCorreo(correo));
    if (!r.id) throw new Error(`No encontré a ${correo} en Microsoft 365.`);
    ids.push(r.id);
  }
  return (propietarioIds = ids);
}

/* --------------------------------- canales --------------------------------- */
async function crearCanal(c) {
  const equipo = nombreEquipo(c), canal = nombreCanal(c);
  const eq = exigir(await providers.teamsBuscarEquipo(equipo));
  if (!eq.id) throw new Error(`No encontré el equipo "${equipo}" en Teams. Créalo (o corrige su nombre) y se reintenta solo cada hora.`);
  const [primero, ...otros] = await idsPropietarios();

  // Si ya existe uno con ese nombre (lo hicieron a mano), se usa ese.
  let canalId = exigir(await providers.teamsBuscarCanal(eq.id, canal)).id;
  if (!canalId) {
    const fecha = new Date(`${calendario.ymd(c.fecha_inicio)}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    canalId = exigir(await providers.teamsCrearCanal(eq.id, {
      nombre: canal, descripcion: `${c.curso} · ${DIAS_LABEL[c.dias] || ''} · inicia el ${fecha}`, propietarioId: primero,
    })).id;
  }
  for (const id of otros) {
    const r = await providers.teamsAgregarAlCanal(eq.id, canalId, id, true);
    if (!r.ok) throw new Error(`Se creó el canal, pero no se pudo agregar a un propietario (¿está en el equipo "${equipo}"?): ${r.error}`);
  }
  await query(`UPDATE cohortes SET teams_equipo_id = $2, teams_canal_id = $3, teams_canal_nombre = $4, teams_error = NULL WHERE id = $1`,
    [c.id, eq.id, canalId, canal]);
}

async function crearCanales() {
  const { rows } = await query(
    `SELECT * FROM cohortes
     WHERE teams_auto AND teams_canal_id IS NULL AND fecha_inicio IS NOT NULL
       AND COALESCE(fecha_fin, fecha_inicio) >= CURRENT_DATE
     ORDER BY fecha_inicio`);
  for (const c of rows) {
    if (Date.now() < momentoCanal(c).getTime()) continue;
    try { await crearCanal(c); }
    catch (err) {
      console.error(`[teams] canal de ${calendario.codigoGrupo(c)}: ${err.message}`);
      await query(`UPDATE cohortes SET teams_error = $2 WHERE id = $1`, [c.id, err.message]);
    }
  }
}

/* --------------------------------- alumnos --------------------------------- */
async function agregarFaltantes() {
  const { rows } = await query(
    `SELECT t.*, a.nombre, c.id AS grupo_id, c.curso, c.teams_equipo_id, c.teams_canal_id, c.teams_canal_nombre
     FROM alumno_teams t
     JOIN alumnos  a ON a.id = t.alumno_id
     JOIN cohortes c ON c.id = a.cohorte_id
     WHERE t.cohorte_id IS NULL AND a.fecha_baja IS NULL AND c.teams_auto AND c.teams_canal_id IS NOT NULL
     ORDER BY t.id`);
  for (const t of rows) {
    try {
      let uid = t.usuario_id || exigir(await providers.usuarioPorCorreo(t.correo)).id;
      let invitado = false;
      if (!uid) {
        uid = exigir(await providers.invitarInvitado({
          correo: t.correo, nombre: t.nombre,
          mensaje: `Hola ${t.nombre.split(' ')[0]}, te damos acceso al canal de tu grupo de ${t.curso} en Microsoft Teams. Acepta esta invitación para entrar a tus clases y ver el material del curso. — Querify Analytics`,
        })).id;
        invitado = true;
      }
      await query(`UPDATE alumno_teams SET usuario_id = $2 WHERE id = $1`, [t.id, uid]);
      exigir(await providers.teamsAgregarAlEquipo(t.teams_equipo_id, uid));
      exigir(await providers.teamsAgregarAlCanal(t.teams_equipo_id, t.teams_canal_id, uid));
      await query(`UPDATE alumno_teams SET cohorte_id = $2, error = NULL, actualizado_en = now() WHERE id = $1`, [t.id, t.grupo_id]);
      await nota(t.alumno_id, `Agregado al canal ${t.teams_canal_nombre} de Teams con ${t.correo}${invitado ? ' (se le mandó la invitación de Microsoft)' : ''}.`);
    } catch (err) {
      console.error(`[teams] alumno #${t.alumno_id} (${t.correo}): ${err.message}`);
      await query(`UPDATE alumno_teams SET error = $2, actualizado_en = now() WHERE id = $1`, [t.id, err.message]);
    }
  }
}

// Baja o cambio de grupo: se le saca del canal donde lo habíamos agregado.
async function quitarSobrantes() {
  const { rows } = await query(
    `SELECT t.*, c.teams_equipo_id, c.teams_canal_id, c.teams_canal_nombre
     FROM alumno_teams t
     JOIN alumnos  a ON a.id = t.alumno_id
     JOIN cohortes c ON c.id = t.cohorte_id
     WHERE a.fecha_baja IS NOT NULL OR a.cohorte_id <> t.cohorte_id`);
  for (const t of rows) {
    try {
      exigir(await providers.teamsQuitarDelCanal(t.teams_equipo_id, t.teams_canal_id, t.usuario_id));
      await query(`UPDATE alumno_teams SET cohorte_id = NULL, error = NULL, actualizado_en = now() WHERE id = $1`, [t.id]);
      await nota(t.alumno_id, `Se le quitó del canal ${t.teams_canal_nombre} de Teams (${t.correo}).`);
    } catch (err) {
      console.error(`[teams] quitar alumno #${t.alumno_id} (${t.correo}): ${err.message}`);
      await query(`UPDATE alumno_teams SET error = $2, actualizado_en = now() WHERE id = $1`, [t.id, `No se pudo quitar del canal: ${err.message}`]);
    }
  }
}

/* ------------------------------- sincronizar ------------------------------- */
let cola = Promise.resolve();
const enCola = fn => { const p = cola.then(fn, fn); cola = p.catch(() => {}); return p; };

function sincronizar() {
  if (!activo()) return Promise.resolve();
  return enCola(async () => {
    await crearCanales();
    // El correo de inscripción siempre es uno de sus correos de Teams (si lo
    // cambian en "Editar datos", el nuevo se agrega y el viejo se queda).
    await query(
      `INSERT INTO alumno_teams (alumno_id, correo)
       SELECT a.id, lower(a.correo) FROM alumnos a JOIN cohortes c ON c.id = a.cohorte_id
       WHERE c.teams_auto AND a.correo IS NOT NULL AND a.fecha_baja IS NULL
       ON CONFLICT (alumno_id, correo) DO NOTHING`);
    await quitarSobrantes();
    await agregarFaltantes();
  });
}

// Para no hacer esperar a quien llama (webhook de Stripe, panel): corre en
// segundo plano y solo deja registro si falla.
const sincronizarLuego = () => { sincronizar().catch(err => console.error('[teams]', err.message)); };

async function agregarCorreo(alumnoId, correo) {
  await query(`INSERT INTO alumno_teams (alumno_id, correo) VALUES ($1, lower($2)) ON CONFLICT (alumno_id, correo) DO NOTHING`,
    [alumnoId, correo.trim()]);
}

module.exports = { activo, nombreEquipo, nombreCanal, momentoCanal, sincronizar, sincronizarLuego, agregarCorreo };
