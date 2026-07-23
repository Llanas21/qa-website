// src/admin.js — panel de administración (login simple + vistas)
const express = require('express');
const bcrypt = require('bcryptjs');
const { config, query } = require('./db');
const engine = require('./engine');

const router = express.Router();
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => d ? new Date(d).toLocaleString('es-MX',
  { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/* ------------------------------ layout ------------------------------ */
function layout(title, body, { nav = true } = {}) {
  const banner = config.admin.passHash ? '' :
    `<div class="warn">⚠ Estás usando la contraseña de demo. Genera un hash con <code>npm run hash -- "tu-clave"</code> y ponlo en <code>ADMIN_PASS_HASH</code>.</div>`;
  const menu = nav ? `<nav class="topnav">
      <span class="brand">Querify · Admin</span>
      <div class="links">
        <a href="/admin">Prospectos</a>
        <a href="/admin/errores">Errores de envío</a>
        <a href="/admin/fechas">Fechas de inicio</a>
        <a href="/admin/logout" class="out">Salir</a>
      </div></nav>` : '';
  return `<!DOCTYPE html><html lang="es-MX"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Querify Admin</title>
<style>
  :root{--ink:#0B1524;--ink2:#122036;--line:#24344f;--txt:#E7EEF7;--muted:#93A4BF;--accent:#0EA5C4;--ok:#16A34A;--warn:#F59E0B;--bad:#F87171;--surf:#0F1C31}
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0A1220;color:var(--txt);font-size:15px}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .topnav{display:flex;justify-content:space-between;align-items:center;background:var(--ink);border-bottom:1px solid var(--line);padding:14px 22px;position:sticky;top:0;z-index:5}
  .topnav .brand{font-weight:700;letter-spacing:-.01em}.topnav .links{display:flex;gap:20px;flex-wrap:wrap}.topnav .out{color:var(--muted)}
  .wrap{max-width:1120px;margin:0 auto;padding:26px 22px}
  h1{font-size:23px;margin:0 0 4px}h2{font-size:18px;margin:26px 0 12px}.sub{color:var(--muted);margin:0 0 18px}
  .warn{background:#3a2c07;color:#ffdf9e;border:1px solid #6b5210;padding:10px 14px;border-radius:8px;margin:0 0 16px;font-size:13.5px}
  code{background:#111e33;padding:1px 6px;border-radius:5px;font-size:.9em}
  table{width:100%;border-collapse:collapse;background:var(--surf);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top}
  th{background:var(--ink2);color:var(--muted);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.03em}
  tr:last-child td{border-bottom:none}tr:hover td{background:#0c1a2e}
  .tag{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .tag.activa{color:#7de3ff;border-color:#164a5c;background:#0c2733}.tag.finalizada{color:#9fb0c8}
  .tag.wa{color:#8ff0c0;border-color:#155e41}.tag.correo{color:#b9c8de}
  .pill{font-size:11px;color:var(--muted)}
  .filters{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}
  select,input[type=date],input[type=text],input[type=password]{background:#0e1c30;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:14px;font-family:inherit}
  .btn{display:inline-block;background:var(--accent);color:#052730;font-weight:600;border:none;border-radius:8px;padding:9px 15px;cursor:pointer;font-size:14px;font-family:inherit}
  .btn.ghost{background:transparent;color:var(--txt);border:1px solid var(--line)}.btn.danger{background:#7f1d1d;color:#fff}
  .btn:hover{filter:brightness(1.08)}
  .card{background:var(--surf);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:16px}
  .kv{display:grid;grid-template-columns:150px 1fr;gap:8px 14px;font-size:14.5px}.kv .k{color:var(--muted)}
  .timeline{list-style:none;padding:0;margin:0}
  .timeline li{border-left:2px solid var(--line);padding:0 0 16px 16px;margin-left:6px;position:relative}
  .timeline li::before{content:"";position:absolute;left:-6px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--accent)}
  .timeline li.fallido::before{background:var(--bad)}.timeline li.entrante::before{background:var(--ok)}
  .timeline .meta{font-size:12.5px;color:var(--muted)}.timeline .body{margin-top:4px;white-space:pre-wrap;font-size:14px;color:#cdd9ea}
  .st{font-size:11.5px;padding:1px 7px;border-radius:6px;border:1px solid var(--line)}
  .st.enviado{color:#8ff0c0}.st.simulado{color:#ffd48a;border-color:#5c4611}.st.fallido{color:var(--bad);border-color:#5c1a1a}.st.recibido{color:#7de3ff}.st.nota{color:var(--muted)}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
  .empty{color:var(--muted);padding:30px;text-align:center}
  .login{max-width:360px;margin:9vh auto;padding:0 20px}.login .card label{display:block;font-size:13px;color:var(--muted);margin:12px 0 6px}
  .login input{width:100%}.err{color:var(--bad);font-size:13.5px;margin-top:10px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:760px){.grid2,.kv{grid-template-columns:1fr}}
  .backlink{display:inline-block;margin-bottom:14px;color:var(--muted)}
</style></head><body>${menu}<div class="wrap">${banner}${body}</div></body></html>`;
}

/* ------------------------------ auth ------------------------------ */
function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  return res.redirect('/admin/login');
}

router.get('/login', (req, res) => {
  res.send(layout('Entrar', `<div class="login"><div class="card">
    <h1>Panel de Querify</h1><p class="sub">Ingresa para gestionar prospectos.</p>
    <form method="post" action="/admin/login">
      <label>Usuario</label><input type="text" name="user" autocomplete="username" autofocus>
      <label>Contraseña</label><input type="password" name="password" autocomplete="current-password">
      <div style="margin-top:16px"><button class="btn" type="submit">Entrar</button></div>
      ${req.query.e ? '<p class="err">Usuario o contraseña incorrectos.</p>' : ''}
    </form></div></div>`, { nav: false }));
});

router.post('/login', async (req, res) => {
  const { user, password } = req.body || {};
  let ok = false;
  if (config.admin.passHash) {
    ok = user === config.admin.user && await bcrypt.compare(password || '', config.admin.passHash);
  } else {
    ok = user === config.admin.user && password === 'querify'; // fallback SOLO si no hay hash configurado
  }
  if (!ok) return res.redirect('/admin/login?e=1');
  req.session.admin = { user };
  res.redirect('/admin');
});

router.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); });

/* --------------------------- lista de prospectos --------------------------- */
router.get('/', requireAuth, async (req, res) => {
  const { estado = '', curso = '' } = req.query;
  const cond = [], params = [];
  if (estado) { params.push(estado); cond.push(`estado_secuencia = $${params.length}`); }
  if (curso) { params.push(curso); cond.push(`curso = $${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM prospectos ${where} ORDER BY fecha_registro DESC`, params);

  const opt = (v, cur, label) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`;
  const cursos = ['Excel', 'SQL Server', 'Power BI', 'Python', 'Aún no decido'];
  const filtros = `<form class="filters" method="get">
      <select name="estado">${opt('', estado, 'Todos los estados')}${opt('activa', estado, 'Activa')}${opt('finalizada', estado, 'Finalizada')}</select>
      <select name="curso">${opt('', curso, 'Todos los cursos')}${cursos.map(c => opt(c, curso, c)).join('')}</select>
      <button class="btn ghost" type="submit">Filtrar</button>
      ${(estado || curso) ? '<a class="btn ghost" href="/admin">Limpiar</a>' : ''}
    </form>`;

  const filas = rows.map(p => `<tr>
      <td><a href="/admin/prospecto/${p.id}"><b>${esc(p.nombre)}</b></a></td>
      <td>${esc(p.curso)}</td>
      <td>${p.telefono ? esc(p.telefono_pais + ' ' + p.telefono) : '<span class="pill">—</span>'}</td>
      <td>${p.correo ? esc(p.correo) : '<span class="pill">—</span>'}</td>
      <td><span class="tag ${p.canal}">${p.canal}</span></td>
      <td>${p.paso_actual} / 3</td>
      <td><span class="tag ${p.estado_secuencia}">${p.estado_secuencia}</span></td>
      <td class="pill">${fmt(p.fecha_registro)}</td>
      <td class="pill">${fmt(p.fecha_ultimo_mensaje)}</td>
    </tr>`).join('');

  const tabla = rows.length ? `<table>
    <thead><tr><th>Nombre</th><th>Curso</th><th>WhatsApp</th><th>Correo</th><th>Canal</th><th>Paso</th><th>Estado</th><th>Registro</th><th>Últ. mensaje</th></tr></thead>
    <tbody>${filas}</tbody></table>` : '<div class="card empty">Aún no hay prospectos. Envía el formulario del sitio para ver el primero aquí.</div>';

  res.send(layout('Prospectos', `<h1>Prospectos</h1><p class="sub">${rows.length} registro(s).</p>${filtros}${tabla}`));
});

/* --------------------------- detalle de prospecto --------------------------- */
router.get('/prospecto/:id', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM prospectos WHERE id = $1`, [req.params.id]);
  const p = rows[0];
  if (!p) return res.status(404).send(layout('No encontrado', '<a class="backlink" href="/admin">← Prospectos</a><div class="card empty">Prospecto no encontrado.</div>'));

  const msgs = (await query(`SELECT * FROM mensajes WHERE prospecto_id = $1 ORDER BY created_at ASC`, [req.params.id])).rows;
  const tl = msgs.length ? `<ul class="timeline">${msgs.map(m => `<li class="${m.estado === 'fallido' ? 'fallido' : m.tipo === 'entrante' ? 'entrante' : ''}">
      <div class="meta">${fmt(m.created_at)} · ${esc(m.tipo)} · ${esc(m.canal)} <span class="st ${m.estado}">${m.estado}</span></div>
      <div class="body">${esc(m.error ? '⚠ ' + m.error : m.contenido)}</div></li>`).join('')}</ul>`
    : '<p class="sub">Sin mensajes todavía.</p>';

  const activa = p.estado_secuencia === 'activa';
  res.send(layout(p.nombre, `
    <a class="backlink" href="/admin">← Prospectos</a>
    <h1>${esc(p.nombre)}</h1>
    <p class="sub">Registrado el ${fmt(p.fecha_registro)} · origen: ${esc(p.origen)}</p>
    <div class="grid2">
      <div class="card"><h2 style="margin-top:0">Contacto</h2><div class="kv">
        <div class="k">Curso</div><div>${esc(p.curso)}</div>
        <div class="k">WhatsApp</div><div>${p.telefono ? esc(p.telefono_pais + ' ' + p.telefono) : '—'}</div>
        <div class="k">Correo</div><div>${p.correo ? esc(p.correo) : '—'}</div>
        <div class="k">Canal activo</div><div><span class="tag ${p.canal}">${p.canal}</span></div>
      </div></div>
      <div class="card"><h2 style="margin-top:0">Secuencia</h2><div class="kv">
        <div class="k">Estado</div><div><span class="tag ${p.estado_secuencia}">${p.estado_secuencia}</span></div>
        <div class="k">Paso</div><div>${p.paso_actual} / 3</div>
        <div class="k">Inicio secuencia</div><div>${fmt(p.fecha_inicio_secuencia)}</div>
        <div class="k">Últ. mensaje</div><div>${fmt(p.fecha_ultimo_mensaje)}</div>
        <div class="k">Últ. respuesta</div><div>${fmt(p.fecha_ultimo_entrante)}</div>
      </div>
      <div class="actions">
        ${activa ? `<form method="post" action="/admin/prospecto/${p.id}/responder"><button class="btn" type="submit">Marcar como respondió</button></form>
        <form method="post" action="/admin/prospecto/${p.id}/pausar"><button class="btn danger" type="submit">Pausar / detener</button></form>`
        : '<span class="pill">Secuencia finalizada. El seguimiento continúa manualmente.</span>'}
      </div></div>
    </div>
    <h2>Historial de mensajes</h2><div class="card">${tl}</div>`));
});

router.post('/prospecto/:id/responder', requireAuth, async (req, res) => {
  await query(`UPDATE prospectos SET estado_secuencia = 'finalizada' WHERE id = $1`, [req.params.id]);
  await engine.registrarMensaje(req.params.id, { tipo: 'sistema', canal: 'sistema', estado: 'nota', contenido: 'Marcado como "respondió" desde el panel. Secuencia detenida.' });
  res.redirect(`/admin/prospecto/${req.params.id}`);
});

router.post('/prospecto/:id/pausar', requireAuth, async (req, res) => {
  await query(`UPDATE prospectos SET estado_secuencia = 'finalizada' WHERE id = $1`, [req.params.id]);
  await engine.registrarMensaje(req.params.id, { tipo: 'sistema', canal: 'sistema', estado: 'nota', contenido: 'Secuencia pausada/detenida manualmente desde el panel.' });
  res.redirect(`/admin/prospecto/${req.params.id}`);
});

/* ------------------------------ errores de envío ------------------------------ */
router.get('/errores', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, p.nombre FROM mensajes m JOIN prospectos p ON p.id = m.prospecto_id
     WHERE m.estado = 'fallido' ORDER BY m.created_at DESC`);
  const tabla = rows.length ? `<table>
    <thead><tr><th>Fecha</th><th>Prospecto</th><th>Tipo</th><th>Canal</th><th>Motivo</th></tr></thead>
    <tbody>${rows.map(m => `<tr>
      <td class="pill">${fmt(m.created_at)}</td>
      <td><a href="/admin/prospecto/${m.prospecto_id}">${esc(m.nombre)}</a></td>
      <td>${esc(m.tipo)}</td><td>${esc(m.canal)}</td>
      <td style="color:#f7a5a5">${esc(m.error || '')}</td></tr>`).join('')}</tbody></table>`
    : '<div class="card empty">Sin errores de envío. 🎉</div>';
  res.send(layout('Errores de envío', `<h1>Errores de envío</h1><p class="sub">Fallos de WhatsApp o correo, para no perder prospectos por fallas silenciosas.</p>${tabla}`));
});

/* ------------------------------ fechas de inicio ------------------------------ */
router.get('/fechas', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM fechas_inicio ORDER BY curso, modalidad`);
  const label = m => m === 'entre_semana' ? 'Entre semana' : 'Sabatino';
  const filas = rows.map(r => `<tr>
      <td>${esc(r.curso)}</td><td>${label(r.modalidad)}</td>
      <td><input type="date" name="fecha_${r.id}" value="${r.fecha ? new Date(r.fecha).toISOString().slice(0, 10) : ''}"></td>
    </tr>`).join('');
  res.send(layout('Fechas de inicio', `
    <h1>Fechas de inicio</h1>
    <p class="sub">Actualiza la próxima fecha de inicio por curso y modalidad. El mensaje de valor (72h) toma automáticamente la fecha futura más cercana del curso.</p>
    <form method="post" action="/admin/fechas"><table>
      <thead><tr><th>Curso</th><th>Modalidad</th><th>Próxima fecha de inicio</th></tr></thead>
      <tbody>${filas}</tbody></table>
      <div style="margin-top:16px"><button class="btn" type="submit">Guardar fechas</button>
      ${req.query.ok ? '<span class="pill" style="margin-left:12px;color:#8ff0c0">✓ Guardado</span>' : ''}</div>
    </form>`));
});

router.post('/fechas', requireAuth, async (req, res) => {
  for (const [key, val] of Object.entries(req.body || {})) {
    const m = key.match(/^fecha_(\d+)$/);
    if (!m) continue;
    await query(`UPDATE fechas_inicio SET fecha = $2 WHERE id = $1`, [m[1], val || null]);
  }
  res.redirect('/admin/fechas?ok=1');
});

module.exports = { router, requireAuth };
