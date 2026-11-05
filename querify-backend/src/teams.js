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
const crypto = require('crypto');
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

/* ---------------------- conexión de la cuenta (delegada) ---------------------- */
// Crear el canal y poner a los propietarios lo hace la app por su cuenta,
// pero Microsoft no le deja agregar INVITADOS a un equipo (403 "An unknown
// error has occurred", limitación conocida). Eso se hace actuando como la
// persona que tocó "Conectar Teams" en el panel, igual que si lo hiciera a
// mano. Se guarda su refresh token (cifrado) y se renueva en cada vuelta
// para que no caduque; si Microsoft lo revoca (cambio de contraseña, etc.),
// el panel pide volver a conectar.
const SCOPES = 'offline_access User.Read https://graph.microsoft.com/TeamMember.ReadWrite.All https://graph.microsoft.com/ChannelMember.ReadWrite.All';
const llave = () => crypto.createHash('sha256').update(config.session.secret).digest();
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), datos].map(b => b.toString('base64')).join('.');
}
function descifrar(guardado) {
  const [iv, tag, datos] = guardado.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', llave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}

let acceso = { token: null, exp: 0 };
async function tokenDelegado() {
  if (config.simulate.teams) return 'simulado';
  if (acceso.token && Date.now() < acceso.exp) return acceso.token;
  const fila = (await query(`SELECT * FROM teams_conexion WHERE id = 1`)).rows[0];
  if (!fila?.refresh_cifrado) throw new Error('Falta conectar Teams: entra a Cohortes y toca "Conectar Teams".');
  let refresh;
  try { refresh = descifrar(fila.refresh_cifrado); } catch { refresh = null; }
  const r = refresh ? await providers.refrescarDelegado(refresh, SCOPES) : { ok: false, codigo: 'invalid_grant', error: 'no se pudo leer la sesión guardada' };
  if (!r.ok) {
    // Revocada o caducada: no tiene caso reintentar con el mismo token.
    if (r.codigo === 'invalid_grant') await query(`UPDATE teams_conexion SET refresh_cifrado = NULL WHERE id = 1`);
    await query(`UPDATE teams_conexion SET error = $1 WHERE id = 1`, [r.error]);
    throw new Error('Se perdió la conexión con Teams: vuelve a conectarla en Cohortes ("Conectar Teams").');
  }
  await query(`UPDATE teams_conexion SET refresh_cifrado = $1, error = NULL WHERE id = 1`, [cifrar(r.refresh)]);
  acceso = { token: r.access, exp: Date.now() + (r.expiraEn - 120) * 1000 };
  return acceso.token;
}

const urlConectar = ({ redirectUri, state }) => providers.urlAutorizacion({ redirectUri, state, scopes: SCOPES });

// Regreso del inicio de sesión: canjea el código y guarda la conexión.
async function conectar({ code, redirectUri }) {
  const r = await providers.canjearCodigo({ code, redirectUri, scopes: SCOPES });
  if (!r.ok) return r;
  const yo = await providers.quienSoy(r.access);
  const usuario = yo.ok ? `${yo.nombre} (${yo.correo})` : 'cuenta de Microsoft';
  await query(
    `INSERT INTO teams_conexion (id, usuario, refresh_cifrado, conectado_en, error) VALUES (1, $1, $2, now(), NULL)
     ON CONFLICT (id) DO UPDATE SET usuario = $1, refresh_cifrado = $2, conectado_en = now(), error = NULL`,
    [usuario, cifrar(r.refresh)]);
  acceso = { token: r.access, exp: Date.now() + (r.expiraEn - 120) * 1000 };
  // Los alumnos que esperaban la conexión ya pueden reintentarse de una vez.
  await query(`UPDATE alumno_teams SET error = NULL WHERE cohorte_id IS NULL`);
  return { ok: true, usuario };
}

async function conexion() {
  return (await query(`SELECT usuario, conectado_en, error, refresh_cifrado IS NOT NULL AS conectado FROM teams_conexion WHERE id = 1`)).rows[0]
    || { conectado: false };
}

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
    const r = await providers.teamsAgregarAlCanal(null, eq.id, canalId, id, true);
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
      const token = await tokenDelegado();
      exigir(await providers.teamsAgregarAlEquipo(token, t.teams_equipo_id, uid));
      exigir(await providers.teamsAgregarAlCanal(token, t.teams_equipo_id, t.teams_canal_id, uid));
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
      exigir(await providers.teamsQuitarDelCanal(await tokenDelegado(), t.teams_equipo_id, t.teams_canal_id, t.usuario_id));
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
    // Renovar la conexión en cada vuelta (cada hora) aunque no haya nada que
    // hacer: así no caduca por falta de uso.
    await tokenDelegado().catch(() => {});
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

module.exports = {
  activo, nombreEquipo, nombreCanal, momentoCanal, sincronizar, sincronizarLuego, agregarCorreo,
  urlConectar, conectar, conexion,
};
