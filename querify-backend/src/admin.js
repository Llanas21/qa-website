// src/admin.js — panel de administración (login simple + vistas)
// Rediseño 15 oct 2026: antes era un panel de prospectos con tema oscuro
// genérico; ahora es la base de una plataforma de administración de la
// academia pensada mobile-first (se instalará como PWA en el celular —
// manifest.webmanifest abajo, service worker + push quedan pendientes como
// siguiente fase, ver ESTADO.md). Misma identidad visual que el sitio
// público (tokens de color/tipografía copiados de querify-web/assets/css/
// styles.css) para que se sienta parte de la misma marca.
const express = require('express');
const bcrypt = require('bcryptjs');
const { config, query } = require('./db');
const engine = require('./engine');

const router = express.Router();
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// timeZone fijo a propósito: el servidor (Railway) corre en UTC, y sin esto se
// mostraba la hora del servidor en vez de la del negocio (Saltillo/CDMX, UTC-6
// todo el año desde que México eliminó el horario de verano en 2022 — no aplica
// el horario de la franja fronteriza aquí). No usar la zona del navegador porque
// esto se renderiza del lado del servidor, no llega a ejecutarse en el cliente.
const fmt = d => d ? new Date(d).toLocaleString('es-MX',
  { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' }) : '—';
const fmtDia = d => d ? new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* --------------------------------- iconos --------------------------------- */
// Mismo estilo que el sitio público: trazo (stroke), sin relleno, viewBox 24x24.
const ICO = {
  alumnos: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  cohortes: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  errores: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  atras: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  cerrar: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  mas: '<path d="M12 5v14"/><path d="M5 12h14"/>',
};
const svg = (nombre, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICO[nombre]}</svg>`;

// Botón flotante (FAB) + hoja/modal que se desliza desde abajo — patrón
// reutilizable para "agregar algo" (alumno, cohorte...) sin ocupar espacio
// fijo en la pantalla con un formulario siempre visible. `autoOpen` lo abre
// solo al cargar (ej. cuando el intento anterior falló y hay un error que
// mostrar ahí mismo, no en la página de fondo).
function fabModal({ id, label, titulo, contenido, autoOpen = false }) {
  return `
    <button class="fab" id="${id}Btn" aria-label="${esc(label)}" type="button">${svg('mas', 26)}</button>
    <div class="modal-overlay" id="${id}Overlay"></div>
    <div class="modal-sheet" id="${id}" aria-hidden="true">
      <div class="modal-head"><h3>${esc(titulo)}</h3><button class="iconbtn" id="${id}Close" type="button" aria-label="Cerrar">${svg('cerrar', 18)}</button></div>
      <div class="modal-body">${contenido}</div>
    </div>
    <script>
      (function(){
        var btn=document.getElementById('${id}Btn'), overlay=document.getElementById('${id}Overlay'),
            panel=document.getElementById('${id}'), close=document.getElementById('${id}Close');
        function abrir(){panel.classList.add('open');overlay.classList.add('open');panel.setAttribute('aria-hidden','false')}
        function cerrar(){panel.classList.remove('open');overlay.classList.remove('open');panel.setAttribute('aria-hidden','true')}
        btn.addEventListener('click', abrir);
        overlay.addEventListener('click', cerrar);
        close.addEventListener('click', cerrar);
        ${autoOpen ? 'abrir();' : ''}
      })();
    </script>`;
}

/* ------------------------------ layout ------------------------------ */
function layout(title, body, { chrome = true, section = '', back = null } = {}) {
  const banner = config.admin.passHash ? '' :
    `<div class="warn">⚠ Estás usando la contraseña de demo. Genera un hash con <code>npm run hash -- "tu-clave"</code> y ponlo en <code>ADMIN_PASS_HASH</code>.</div>`;
  const bannerPausa = config.automatizacionPausada
    ? `<div class="warn">⏸ Automatización pausada — no se manda bienvenida, recordatorio/valor/cierre ni recordatorios de pago. La confirmación de inscripción al pagar sí sigue activa. Quita <code>AUTOMATIZACION_PAUSADA</code> en Railway para reanudar.</div>` : '';

  // `chrome` apaga TODO (topbar + menú) — solo para /login. Cualquier otra
  // página autenticada siempre trae el topbar: el botón de "volver" (cuando
  // `back` aplica) es un atajo corto para una página de detalle, y el botón
  // de hamburguesa de la derecha siempre abre el menú lateral con las
  // secciones + salir — nunca se deja a nadie "atrapado" sin salida.
  // Menú lateral en vez de barra inferior a propósito (15 oct 2026, pedido
  // del usuario): dijo que así puede seguir agregando pantallas después sin
  // pelearse por espacio horizontal, cosa que una tabbar de iconos sí limita.
  const tabs = [
    { id: 'alumnos', href: '/admin/alumnos', label: 'Alumnos', ico: 'alumnos' },
    { id: 'cohortes', href: '/admin/cohortes', label: 'Cohortes', ico: 'cohortes' },
    { id: 'errores', href: '/admin/errores', label: 'Errores', ico: 'errores' },
  ];

  const topbar = chrome ? `<header class="topbar">
      ${back ? `<a class="iconbtn" href="${back}" aria-label="Volver">${svg('atras', 20)}</a>`
        : `<span class="brand"><img src="/assets/img/querify-logo.png" alt=""><span>Querify <b>Admin</b></span></span>`}
      <button class="iconbtn" id="menuBtn" aria-label="Abrir menú" aria-expanded="false" aria-controls="drawer" type="button">${svg('menu', 20)}</button>
    </header>` : '';

  const drawer = chrome ? `
    <div class="drawer-overlay" id="drawerOverlay"></div>
    <nav class="drawer" id="drawer" aria-hidden="true" aria-label="Menú principal">
      <div class="drawer-head">
        <span class="brand"><img src="/assets/img/querify-logo.png" alt=""><span>Querify <b>Admin</b></span></span>
      </div>
      <div class="drawer-links">
        ${tabs.map(t => `<a href="${t.href}" class="drawer-link ${section === t.id ? 'active' : ''}">${svg(t.ico, 20)}<span>${t.label}</span></a>`).join('')}
      </div>
      <div class="drawer-sep"></div>
      <a href="/admin/logout" class="drawer-link drawer-logout">${svg('salir', 20)}<span>Salir</span></a>
    </nav>
    <script>
      (function(){
        var btn=document.getElementById('menuBtn'), overlay=document.getElementById('drawerOverlay'),
            panel=document.getElementById('drawer');
        if(!btn||!panel) return;
        function abrir(){panel.classList.add('open');overlay.classList.add('open');btn.setAttribute('aria-expanded','true');panel.setAttribute('aria-hidden','false')}
        function cerrar(){panel.classList.remove('open');overlay.classList.remove('open');btn.setAttribute('aria-expanded','false');panel.setAttribute('aria-hidden','true')}
        btn.addEventListener('click', abrir);
        overlay.addEventListener('click', cerrar);
      })();
    </script>` : '';

  return `<!DOCTYPE html><html lang="es-MX"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — Querify Admin</title>
<meta name="theme-color" content="#2563EB">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Querify Admin">
<link rel="manifest" href="/admin/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/img/querify-logo.png">
<link rel="icon" type="image/png" href="/assets/img/querify-logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#0F1E33;--bg:#F6F9FD;--surface:#FFFFFF;--surface-2:#EEF3FB;
    --line:#E1E9F4;--line-2:#CFDBEC;--text:#12233D;--muted:#51617C;--muted-2:#7A88A0;
    --accent:#3B82F6;--accent-strong:#2563EB;--accent-ink:#1D4ED8;--accent-soft:#E8F0FE;--accent-line:#C9DCFB;
    --on-accent:#FFFFFF;--ok:#16A34A;--ok-soft:#E7F7ED;--ok-line:#BBEBCB;--ok-ink:#166534;
    --warn-soft:#FEF3E0;--warn-line:#F7DCA6;--warn-ink:#92400E;
    --bad:#DC2626;--bad-soft:#FDEAEA;--bad-line:#F5C2C2;--bad-ink:#991B1B;
    --font:'Poppins',system-ui,-apple-system,sans-serif;
    --r-sm:9px;--r-md:13px;--r-lg:18px;
    --shadow-sm:0 1px 2px rgba(18,35,61,.05);--shadow-md:0 8px 20px rgba(18,35,61,.08);
    --drawer-w:280px;
  }
  *,*::before,*::after{box-sizing:border-box;min-width:0}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;font-family:var(--font);background:var(--bg);color:var(--text);font-size:15px;-webkit-font-smoothing:antialiased;
    overflow-wrap:anywhere;overflow-x:hidden}
  a{color:var(--accent-ink);text-decoration:none}
  a:hover{text-decoration:underline}
  img{max-width:100%}

  .topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;
    background:var(--surface);border-bottom:1px solid var(--line);
    padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;position:sticky;top:0;z-index:10}
  .topbar .brand{display:flex;align-items:center;gap:9px;font-weight:600;color:var(--ink);font-size:15.5px}
  .topbar .brand img{width:26px;height:26px;display:block}
  .topbar .brand b{font-weight:700}
  .iconbtn{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:999px;
    color:var(--muted);border:1.5px solid var(--line-2);flex:0 0 auto;background:none;cursor:pointer;padding:0;font-family:inherit}
  .iconbtn:hover{background:var(--surface-2);text-decoration:none;color:var(--text)}
  .iconbtn svg{stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

  /* Menú lateral (hamburguesa) — reemplaza la barra inferior de pestañas:
     deja espacio para ir agregando más pantallas sin pelear por ancho. */
  .drawer-overlay{position:fixed;inset:0;background:rgba(15,30,51,.35);opacity:0;visibility:hidden;
    transition:opacity .2s ease;z-index:20}
  .drawer-overlay.open{opacity:1;visibility:visible}
  .drawer{position:fixed;top:0;bottom:0;left:0;width:min(var(--drawer-w),82vw);background:var(--surface);
    z-index:21;transform:translateX(-100%);transition:transform .22s ease;display:flex;flex-direction:column;
    box-shadow:var(--shadow-md);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
  .drawer.open{transform:translateX(0)}
  .drawer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 14px 14px 18px;border-bottom:1px solid var(--line)}
  .drawer-head .brand{display:flex;align-items:center;gap:9px;font-weight:600;color:var(--ink);font-size:15px}
  .drawer-head .brand img{width:24px;height:24px}
  .drawer-links{display:flex;flex-direction:column;padding:10px}
  .drawer-link{display:flex;align-items:center;gap:13px;padding:12px 12px;border-radius:var(--r-sm);
    color:var(--muted);font-size:14.5px;font-weight:600}
  .drawer-link svg{stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
  .drawer-link:hover{background:var(--surface-2);text-decoration:none}
  .drawer-link.active{color:var(--accent-strong);background:var(--accent-soft)}
  .drawer-sep{height:1px;background:var(--line);margin:4px 14px}
  .drawer-logout{margin:6px 10px 14px}

  .wrap{max-width:720px;margin:0 auto;padding:18px 16px 24px}
  h1{font-size:21px;margin:0 0 4px;color:var(--ink);letter-spacing:-.01em;font-weight:700}
  h2{font-size:15.5px;margin:26px 0 10px;color:var(--ink);font-weight:700}
  h2:first-child{margin-top:0}
  .sub{color:var(--muted);margin:0 0 16px;font-size:13.5px;line-height:1.5}
  .warn{background:var(--warn-soft);color:var(--warn-ink);border:1px solid var(--warn-line);padding:10px 14px;border-radius:var(--r-sm);margin:0 0 14px;font-size:12.5px;line-height:1.5}
  code{background:var(--surface-2);padding:1px 6px;border-radius:5px;font-size:.9em}

  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:16px 18px;margin-bottom:12px;box-shadow:var(--shadow-sm);overflow:hidden}
  .empty{color:var(--muted);padding:34px 20px;text-align:center;font-size:13.5px;background:var(--surface);border:1px dashed var(--line-2);border-radius:var(--r-lg)}

  /* Listas de tarjetas (en vez de tablas) — pensadas para dedo, no para mouse */
  .list{display:flex;flex-direction:column;gap:9px;margin:0 0 16px}
  .list-item{display:block;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);
    padding:13px 16px;box-shadow:var(--shadow-sm);color:inherit}
  a.list-item:hover{border-color:var(--accent-line);text-decoration:none}
  .li-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .li-title{font-weight:600;color:var(--ink);font-size:14.5px}
  .li-meta{color:var(--muted);font-size:12.5px;margin-top:3px;line-height:1.5}
  .li-right{text-align:right;flex:0 0 auto;font-size:12.5px;color:var(--muted)}

  .tag{display:inline-block;font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);font-weight:600;white-space:nowrap}
  .tag.activa{color:var(--accent-ink);border-color:var(--accent-line);background:var(--accent-soft)}
  .tag.finalizada{color:var(--muted-2)}
  .tag.ok{color:var(--ok-ink);border-color:var(--ok-line);background:var(--ok-soft)}
  .tag.bad{color:var(--bad-ink);border-color:var(--bad-line);background:var(--bad-soft)}
  .tag.whatsapp{color:var(--ok-ink);border-color:var(--ok-line);background:var(--ok-soft)}
  .tag.correo{color:var(--accent-ink);border-color:var(--accent-line);background:var(--accent-soft)}
  .pill{font-size:12.5px;color:var(--muted);margin:0 0 10px}
  .pill.ok{color:var(--ok-ink);font-weight:600}
  .pill.bad{color:var(--bad-ink);font-weight:600}

  .filters{display:flex;gap:9px;flex-wrap:wrap;margin:0 0 16px}
  .field{margin:0 0 14px}
  .field label{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin:0 0 6px}
  select,input[type=date],input[type=text],input[type=password],input[type=email],input[type=tel],textarea{
    background:var(--surface);color:var(--text);border:1.5px solid var(--line-2);border-radius:var(--r-sm);
    padding:11px 13px;font-size:14.5px;font-family:inherit;width:100%;max-width:100%;box-sizing:border-box}
  /* input[type=date] en Safari/iOS puede insistir en un ancho mínimo propio y
     salirse de su contenedor pase lo que diga width:100% — esto fuerza que al
     menos no se salga visualmente de la tarjeta blanca (ver ESTADO.md, 15 oct 2026). */
  input[type=date]{min-width:0;text-align:left}
  /* Safari centra el valor del input de fecha por dentro de un pseudo-elemento
     propio (::-webkit-date-and-time-value), que ignora el text-align normal
     del input — hace falta apuntarle directo para que quede a la izquierda
     igual que los demás campos (ver ESTADO.md, 15 oct 2026). */
  input[type=date]::-webkit-date-and-time-value{text-align:left}
  select:focus,input:focus,textarea:focus{outline:none;border-color:var(--accent)}
  textarea{resize:vertical}

  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--accent-strong);color:var(--on-accent);
    font-weight:600;border:none;border-radius:999px;padding:12px 22px;cursor:pointer;font-size:14.5px;font-family:inherit;
    transition:transform .1s ease, filter .15s ease;white-space:nowrap}
  .btn:active{transform:translateY(1px)}
  .btn:hover{filter:brightness(1.08);text-decoration:none}
  .btn.ghost{background:transparent;color:var(--text);border:1.5px solid var(--line-2)}
  .btn.ghost:hover{background:var(--surface-2);filter:none}
  .btn.danger{background:var(--bad-soft);color:var(--bad-ink);border:1.5px solid var(--bad-line)}
  .btn.danger:hover{filter:none;background:#FBDADA}
  .btn.block{width:100%}

  .kv{display:grid;grid-template-columns:120px 1fr;gap:9px 12px;font-size:14px}
  .kv .k{color:var(--muted);font-size:12.5px;font-weight:600;padding-top:2px}
  .timeline{list-style:none;padding:0;margin:0}
  .timeline li{border-left:2px solid var(--line);padding:0 0 16px 16px;margin-left:5px;position:relative}
  .timeline li::before{content:"";position:absolute;left:-6px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--accent-strong);border:2px solid var(--surface)}
  .timeline li.fallido::before{background:var(--bad)}
  .timeline li.entrante::before{background:var(--ok)}
  .timeline .meta{font-size:12px;color:var(--muted)}
  .timeline .body{margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;color:var(--text);line-height:1.5}
  .st{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;white-space:nowrap}
  .st.enviado{color:var(--ok-ink);background:var(--ok-soft)}
  .st.simulado{color:var(--warn-ink);background:var(--warn-soft)}
  .st.fallido{color:var(--bad-ink);background:var(--bad-soft)}
  .st.recibido{color:var(--accent-ink);background:var(--accent-soft)}
  .st.nota{color:var(--muted);background:var(--surface-2)}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}

  /* Centrado real con flex + dvh (en vez de un margin-top en vh fijo) para que
     quede bien en cualquier alto de pantalla, no solo en el que se probó. */
  body:has(.login-wrap){display:flex;min-height:100dvh}
  body:has(.login-wrap) .wrap{display:flex;align-items:center;width:100%;padding-top:24px;padding-bottom:24px}
  .login-wrap{max-width:360px;width:100%;margin:0 auto;padding:0 20px}
  .login-wrap .logo{display:block;margin:0 auto 16px;width:50px;height:50px}
  .login-wrap h1{text-align:center}
  .login-wrap .sub{text-align:center}
  .err{color:var(--bad);font-size:13.5px;margin-top:10px}

  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:600px){.grid2{grid-template-columns:1fr}}

  /* Botón flotante + hoja modal — para formularios de "agregar algo" que no
     necesitan estar siempre visibles ocupando la pantalla (alumno, cohorte). */
  .fab{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));width:56px;height:56px;
    border-radius:50%;background:var(--accent-strong);color:var(--on-accent);border:none;cursor:pointer;
    display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-md);z-index:15}
  .fab:hover{filter:brightness(1.08)}
  .fab:active{transform:translateY(1px)}
  .fab svg{stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .modal-overlay{position:fixed;inset:0;background:rgba(15,30,51,.35);opacity:0;visibility:hidden;
    transition:opacity .2s ease;z-index:30}
  .modal-overlay.open{opacity:1;visibility:visible}
  .modal-sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow-y:auto;background:var(--surface);
    border-radius:18px 18px 0 0;box-shadow:var(--shadow-md);z-index:31;transform:translateY(100%);
    transition:transform .22s ease;padding-bottom:env(safe-area-inset-bottom,0px)}
  .modal-sheet.open{transform:translateY(0)}
  .modal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 10px 10px 20px;
    position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--line)}
  .modal-head h3{margin:0;font-size:16px;color:var(--ink)}
  .modal-body{padding:16px 20px 22px}
  .backlink{display:inline-flex;align-items:center;gap:4px;margin-bottom:14px;color:var(--muted);font-size:13.5px;font-weight:600}

  .table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:16px;-webkit-overflow-scrolling:touch}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13.5px;vertical-align:top;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.03em;background:var(--surface-2)}
  tr:last-child td{border-bottom:none}

  /* Plan de pagos del alumno: lista tipo "stepper", no tabla */
  .pagos{display:flex;flex-direction:column;gap:8px;margin:0 0 16px}
  .pago-row{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);
    border-radius:var(--r-md);padding:12px 14px;box-shadow:var(--shadow-sm)}
  .pago-num{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:var(--surface-2);color:var(--muted);
    display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
  .pago-row.pagado .pago-num{background:var(--ok-soft);color:var(--ok-ink)}
  .pago-row.vencido .pago-num{background:var(--bad-soft);color:var(--bad-ink)}
  .pago-info{flex:1 1 auto;min-width:0}
  .pago-info .monto{font-weight:600;color:var(--ink);font-size:14px}
  .pago-info .venc{color:var(--muted);font-size:12.5px;margin-top:1px}
  .pago-right{flex:0 0 auto;text-align:right}
</style></head><body>${topbar}<div class="wrap">${banner}${bannerPausa}${body}</div>${drawer}</body></html>`;
}

// Manifest de la PWA — instalable desde el celular ("Agregar a pantalla de
// inicio"). El service worker + push de verdad quedan pendientes (próxima
// fase, ver ESTADO.md); esto solo deja la base de instalabilidad lista.
router.get('/manifest.webmanifest', (req, res) => {
  res.json({
    name: 'Querify Analytics — Admin',
    short_name: 'Querify Admin',
    start_url: '/admin',
    scope: '/admin',
    display: 'standalone',
    background_color: '#F6F9FD',
    theme_color: '#2563EB',
    icons: [{ src: '/assets/img/querify-logo.png', sizes: '1254x1254', type: 'image/png', purpose: 'any' }],
  });
});

/* ------------------------------ auth ------------------------------ */
function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  return res.redirect('/admin/login');
}

router.get('/login', (req, res) => {
  res.send(layout('Entrar', `<div class="login-wrap">
    <img class="logo" src="/assets/img/querify-logo.png" alt="">
    <h1>Panel de Querify</h1><p class="sub">Ingresa para administrar la academia.</p>
    <div class="card">
      <form method="post" action="/admin/login">
        <div class="field"><label>Usuario</label><input type="text" name="user" autocomplete="username" autofocus></div>
        <div class="field" style="margin-bottom:6px"><label>Contraseña</label><input type="password" name="password" autocomplete="current-password"></div>
        ${req.query.e ? '<p class="err">Usuario o contraseña incorrectos.</p>' : ''}
        <button class="btn block" type="submit" style="margin-top:10px">Entrar</button>
      </form>
    </div></div>`, { chrome: false }));
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
  res.redirect('/admin/alumnos');
});

router.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); });

/* --------------------------- lista de prospectos ---------------------------
   Ya no está en el menú (ver ESTADO.md, 15 oct 2026 — los prospectos ahora
   se llevan a mano en WhatsApp Business) pero la ruta se deja intacta: los
   datos históricos siguen aquí y /admin/prospecto/:id sigue funcionando
   (ej. para revisar el timeline de alguien que sí alcanzó a quedar
   registrado antes del cambio). */
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

  const tabla = rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Nombre</th><th>Curso</th><th>WhatsApp</th><th>Correo</th><th>Canal</th><th>Paso</th><th>Estado</th><th>Registro</th><th>Últ. mensaje</th></tr></thead>
    <tbody>${filas}</tbody></table></div>` : '<div class="empty">Aún no hay prospectos.</div>';

  res.send(layout('Prospectos', `<h1>Prospectos</h1><p class="sub">${rows.length} registro(s) — histórico, ya no se alimenta del sitio.</p>${filtros}${tabla}`, { back: '/admin/alumnos' }));
});

/* --------------------------- detalle de prospecto --------------------------- */
router.get('/prospecto/:id', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM prospectos WHERE id = $1`, [req.params.id]);
  const p = rows[0];
  if (!p) return res.status(404).send(layout('No encontrado', '<div class="empty">Prospecto no encontrado.</div>', { back: '/admin' }));

  const msgs = (await query(`SELECT * FROM mensajes WHERE prospecto_id = $1 ORDER BY created_at ASC`, [req.params.id])).rows;
  const tl = msgs.length ? `<ul class="timeline">${msgs.map(m => `<li class="${m.estado === 'fallido' ? 'fallido' : m.tipo === 'entrante' ? 'entrante' : ''}">
      <div class="meta">${fmt(m.created_at)} · ${esc(m.tipo)} · ${esc(m.canal)} <span class="st ${m.estado}">${m.estado}</span></div>
      <div class="body">${esc(m.error ? '⚠ ' + m.error : m.contenido)}</div></li>`).join('')}</ul>`
    : '<p class="sub">Sin mensajes todavía.</p>';

  const activa = p.estado_secuencia === 'activa';
  const aviso = req.query.enviado ? `<p class="pill ok">✓ Mensaje mandado.</p>`
    : req.query.error ? `<p class="pill bad">✗ No se pudo mandar: ${esc(req.query.error)}</p>` : '';
  const responder = p.telefono ? `
      <div class="card"><h2 style="margin-top:0">Responder por WhatsApp</h2>
        <form method="post" action="/admin/prospecto/${p.id}/enviar-mensaje">
          <textarea name="texto" rows="3" placeholder="Escribe tu respuesta..." required></textarea>
          <button class="btn" type="submit" style="margin-top:10px">Mandar</button>
        </form>
      </div>` : '';
  res.send(layout(p.nombre, `
    <h1>${esc(p.nombre)}</h1>
    <p class="sub">Registrado el ${fmt(p.fecha_registro)} · origen: ${esc(p.origen)}</p>
    ${aviso}
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
        ${activa ? `<form method="post" action="/admin/prospecto/${p.id}/responder"><button class="btn ghost" type="submit">Marcar como respondió</button></form>
        <form method="post" action="/admin/prospecto/${p.id}/pausar"><button class="btn danger" type="submit">Pausar / detener</button></form>`
        : '<span class="pill">Secuencia finalizada. El seguimiento continúa manualmente.</span>'}
      </div></div>
    </div>
    ${responder}
    <h2>Historial de mensajes</h2><div class="card">${tl}</div>`,
    { back: '/admin' }));
});

router.post('/prospecto/:id/enviar-mensaje', requireAuth, async (req, res) => {
  const texto = (req.body?.texto || '').toString().trim();
  if (!texto) return res.redirect(`/admin/prospecto/${req.params.id}?error=${encodeURIComponent('Escribe algo primero.')}`);
  const { rows } = await query(`SELECT * FROM prospectos WHERE id = $1`, [req.params.id]);
  const p = rows[0];
  if (!p) return res.status(404).send(layout('No encontrado', '<div class="empty">Prospecto no encontrado.</div>', { back: '/admin' }));
  const r = await engine.responderManual(p, texto);
  if (r.ok) return res.redirect(`/admin/prospecto/${req.params.id}?enviado=1`);
  res.redirect(`/admin/prospecto/${req.params.id}?error=${encodeURIComponent(r.error || 'error desconocido')}`);
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
  const lista = rows.length ? `<div class="list">${rows.map(m => `
    <a class="list-item" href="/admin/prospecto/${m.prospecto_id}">
      <div class="li-top">
        <div><div class="li-title">${esc(m.nombre)}</div>
          <div class="li-meta">${esc(m.tipo)} · ${esc(m.canal)}</div>
          <div class="li-meta" style="color:var(--bad-ink)">⚠ ${esc(m.error || '')}</div>
        </div>
        <div class="li-right">${fmt(m.created_at)}</div>
      </div>
    </a>`).join('')}</div>`
    : '<div class="empty">Sin errores de envío. 🎉</div>';
  res.send(layout('Errores de envío', `<h1>Errores de envío</h1>${lista}`, { section: 'errores' }));
});

/* ------------------------------ cohortes ------------------------------ */
// Reemplaza a la antigua vista de "fechas de inicio": además de la fecha,
// aquí se administra el cupo por cohorte (10 alumnos por default) y se dan
// de alta nuevas generaciones cuando una cohorte se llena o termina.
const label = m => m === 'entre_semana' ? 'Entre semana' : 'Sabatino';

router.get('/cohortes', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM cohortes ORDER BY curso, fecha_inicio NULLS LAST, modalidad`);
  const cursos = ['Excel', 'SQL Server', 'Power BI', 'Python'];

  const tarjetas = rows.map(r => `
    <div class="card" style="margin-bottom:10px">
      <div class="li-top" style="margin-bottom:12px">
        <div class="li-title">${esc(r.curso)} <span class="pill" style="margin:0">· ${label(r.modalidad)}</span></div>
        <span class="tag ${r.lugares_ocupados >= r.cupo_maximo ? 'bad' : 'ok'}">${r.lugares_ocupados} / ${r.cupo_maximo} ocupados</span>
      </div>
      <div class="grid2">
        <div class="field" style="margin-bottom:0"><label>Fecha de inicio</label>
          <input type="date" name="fecha_${r.id}" value="${r.fecha_inicio ? new Date(r.fecha_inicio).toISOString().slice(0, 10) : ''}"></div>
        <div class="field" style="margin-bottom:0"><label>Cupo máximo</label>
          <input type="text" inputmode="numeric" name="cupo_${r.id}" value="${r.cupo_maximo}"></div>
      </div>
      <a href="/admin/grupo/${r.id}" style="display:inline-block;margin-top:12px;font-size:13px;font-weight:600">Ver alumnos de este grupo →</a>
    </div>`).join('');

  res.send(layout('Cohortes', `
    <h1>Cohortes</h1>
    <form method="post" action="/admin/cohortes">
      ${tarjetas}
      <div style="margin:4px 0 24px">
        <button class="btn block" type="submit">Guardar cambios</button>
        ${req.query.ok ? '<p class="pill ok" style="margin-top:10px;text-align:center">✓ Guardado</p>' : ''}
      </div>
    </form>
    ${fabModal({
      id: 'nuevaCohorte', label: 'Nueva cohorte', titulo: 'Nueva cohorte',
      contenido: `
        <form method="post" action="/admin/cohortes/nueva">
          <div class="field"><label>Curso</label>
            <select name="curso">${cursos.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
          <div class="field"><label>Modalidad</label>
            <select name="modalidad"><option value="entre_semana">Entre semana</option><option value="sabatino">Sabatino</option></select></div>
          <div class="field"><label>Fecha de inicio</label><input type="date" name="fecha_inicio" required></div>
          <div class="field"><label>Cupo</label><input type="text" inputmode="numeric" name="cupo_maximo" placeholder="Cupo" value="10"></div>
          <button class="btn block" type="submit">Agregar cohorte</button>
        </form>`,
    })}`, { section: 'cohortes' }));
});

router.post('/cohortes', requireAuth, async (req, res) => {
  const body = req.body || {};
  for (const [key, val] of Object.entries(body)) {
    const mFecha = key.match(/^fecha_(\d+)$/);
    if (mFecha) { await query(`UPDATE cohortes SET fecha_inicio = $2 WHERE id = $1`, [mFecha[1], val || null]); continue; }
    const mCupo = key.match(/^cupo_(\d+)$/);
    if (mCupo) {
      const cupo = parseInt(val, 10);
      if (Number.isFinite(cupo) && cupo > 0) await query(`UPDATE cohortes SET cupo_maximo = $2 WHERE id = $1`, [mCupo[1], cupo]);
    }
  }
  res.redirect('/admin/cohortes?ok=1');
});

router.post('/cohortes/nueva', requireAuth, async (req, res) => {
  const { curso, modalidad, fecha_inicio, cupo_maximo } = req.body || {};
  const cupo = parseInt(cupo_maximo, 10) || 10;
  if (curso && modalidad && fecha_inicio) {
    await query(
      `INSERT INTO cohortes (curso, modalidad, fecha_inicio, cupo_maximo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (curso, modalidad, fecha_inicio) DO NOTHING`,
      [curso, modalidad, fecha_inicio, cupo]);
  }
  res.redirect('/admin/cohortes?ok=1');
});

/* ------------------------------ alumnos y pagos ------------------------------
   /admin/alumnos ya no lista alumnos directamente — lista los GRUPOS (una
   cohorte con al menos un alumno), más reciente primero. Cada grupo abre
   /admin/grupo/:id con sus alumnos. */
router.get('/alumnos', requireAuth, async (req, res) => {
  const { rows } = await query(`
    SELECT c.id, c.curso, c.modalidad, c.fecha_inicio,
           COUNT(DISTINCT a.id) AS total,
           COUNT(p.*) FILTER (WHERE p.estado = 'vencido') AS vencidos
    FROM cohortes c
    JOIN alumnos a ON a.cohorte_id = c.id
    LEFT JOIN pagos p ON p.alumno_id = a.id
    GROUP BY c.id
    ORDER BY c.fecha_inicio DESC NULLS LAST, c.id DESC`);

  const lista = rows.length ? `<div class="list">${rows.map(g => `
    <a class="list-item" href="/admin/grupo/${g.id}">
      <div class="li-top">
        <div><div class="li-title">${esc(g.curso)} <span class="pill" style="margin:0">· ${label(g.modalidad)}</span></div>
          <div class="li-meta">inicia ${fmtDia(g.fecha_inicio)}</div>
        </div>
        <div class="li-right">
          <span class="tag">${g.total} alumno${g.total == 1 ? '' : 's'}</span>
          ${g.vencidos > 0 ? `<div style="margin-top:5px"><span class="tag bad">${g.vencidos} vencido(s)</span></div>` : ''}
        </div>
      </div>
    </a>`).join('')}</div>` : '<div class="empty">Aún no hay alumnos inscritos.</div>';

  res.send(layout('Alumnos', `<h1>Alumnos</h1>${lista}`, { section: 'alumnos' }));
});

router.get('/grupo/:id', requireAuth, async (req, res) => {
  const cohorte = (await query(`SELECT * FROM cohortes WHERE id = $1`, [req.params.id])).rows[0];
  if (!cohorte) return res.status(404).send(layout('No encontrado', '<div class="empty">Grupo no encontrado.</div>', { back: '/admin/alumnos', section: 'alumnos' }));

  const { rows } = await query(`
    SELECT a.*,
           COUNT(p.*) FILTER (WHERE p.estado = 'pagado') AS pagados,
           COUNT(p.*) FILTER (WHERE p.estado = 'vencido') AS vencidos
    FROM alumnos a
    LEFT JOIN pagos p ON p.alumno_id = a.id
    WHERE a.cohorte_id = $1
    GROUP BY a.id
    ORDER BY a.fecha_alta DESC`, [req.params.id]);

  const lista = rows.length ? `<div class="list">${rows.map(a => `
    <a class="list-item" href="/admin/alumno/${a.id}">
      <div class="li-top">
        <div class="li-title">${esc(a.nombre)}${a.archivado ? ' <span class="tag">archivado</span>' : ''}</div>
        <div class="li-right">
          <span class="tag ${a.vencidos > 0 ? 'bad' : a.pagados >= 5 ? 'ok' : ''}">${a.pagados} / 5 pagados</span>
          ${a.vencidos > 0 ? `<div style="margin-top:5px"><span class="tag bad">${a.vencidos} vencido(s)</span></div>` : ''}
        </div>
      </div>
    </a>`).join('')}</div>` : '<div class="empty">Aún no hay alumnos en este grupo.</div>';

  const aviso = req.query.error ? `<p class="pill bad">✗ ${esc(req.query.error)}</p>` : '';
  const sinCupo = cohorte.lugares_ocupados >= cohorte.cupo_maximo;

  res.send(layout(`${cohorte.curso} · ${label(cohorte.modalidad)}`, `
    <h1>${esc(cohorte.curso)} <span class="pill" style="margin:0">· ${label(cohorte.modalidad)}</span></h1>
    <p class="sub">Inicia ${fmtDia(cohorte.fecha_inicio)} · ${cohorte.lugares_ocupados} / ${cohorte.cupo_maximo} ocupados</p>
    ${lista}
    ${sinCupo ? '' : fabModal({
      id: 'altaAlumno', label: 'Dar de alta un alumno', titulo: 'Dar de alta un alumno',
      autoOpen: !!req.query.error,
      contenido: `
        ${aviso}
        <form method="post" action="/admin/alumnos/nuevo">
          <input type="hidden" name="cohorteId" value="${cohorte.id}">
          <div class="field"><label>Nombre completo</label><input type="text" name="nombre" placeholder="Nombre completo" required></div>
          <div class="field"><label>Correo</label><input type="email" name="correo" placeholder="correo@ejemplo.com" required></div>
          <div class="field"><label>WhatsApp <span style="font-weight:400">(opcional, se asume +52)</span></label>
            <input type="tel" inputmode="numeric" name="whatsapp" placeholder="10 dígitos"></div>
          <button class="btn block" type="submit">Dar de alta</button>
        </form>`,
    })}`, { back: '/admin/alumnos', section: 'alumnos' }));
});

router.post('/alumnos/nuevo', requireAuth, async (req, res) => {
  const b = req.body || {};
  const cohorteId = Number(b.cohorteId);
  const nombre = (b.nombre || '').toString().trim();
  const correo = (b.correo || '').toString().trim();
  const numero = (b.whatsapp || '').toString().replace(/\D/g, '');
  const volver = Number.isInteger(cohorteId) && cohorteId > 0 ? `/admin/grupo/${cohorteId}` : '/admin/alumnos';

  if (!Number.isInteger(cohorteId) || cohorteId <= 0 || nombre.length < 2 || !correo) {
    return res.redirect(`${volver}?error=${encodeURIComponent('Llena nombre y correo.')}`);
  }

  const r = await engine.altaAlumnoManual({
    cohorteId, nombre, correo,
    whatsapp: numero ? { pais: '+52', numero } : null,
  });
  if (!r.ok) {
    const msg = r.motivo === 'sin_cupo' ? 'Esa cohorte ya no tiene cupo disponible.' : 'No se pudo dar de alta (cohorte no encontrada).';
    return res.redirect(`${volver}?error=${encodeURIComponent(msg)}`);
  }
  res.redirect(`/admin/alumno/${r.alumno.id}?creado=1`);
});

router.get('/alumno/:id', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, c.curso, c.modalidad, c.fecha_inicio FROM alumnos a JOIN cohortes c ON c.id = a.cohorte_id WHERE a.id = $1`,
    [req.params.id]);
  const a = rows[0];
  if (!a) return res.status(404).send(layout('No encontrado', '<div class="empty">Alumno no encontrado.</div>', { back: '/admin/alumnos' }));

  const pagos = (await query(`SELECT * FROM pagos WHERE alumno_id = $1 ORDER BY numero_pago ASC`, [req.params.id])).rows;
  const filasPago = pagos.map(p => `
    <div class="pago-row ${p.estado}">
      <div class="pago-num">${p.estado === 'pagado' ? '✓' : p.numero_pago}</div>
      <div class="pago-info">
        <div class="monto">Pago ${p.numero_pago}/5 — $${Number(p.monto)} MXN</div>
        <div class="venc">Vence ${fmtDia(p.fecha_vencimiento)}${p.fecha_pago ? ` · pagado ${fmt(p.fecha_pago)}${p.metodo ? ` (${p.metodo})` : ''}` : ''}</div>
      </div>
      <div class="pago-right">
        ${p.estado === 'pagado' ? `<span class="tag ok">pagado</span>`
          : p.estado === 'vencido' ? `<form method="post" action="/admin/alumno/${a.id}/pago/${p.id}/marcar-pagado"><button class="btn danger sm" type="submit" style="padding:7px 13px;font-size:12.5px">Vencido · marcar pagado</button></form>`
          : `<form method="post" action="/admin/alumno/${a.id}/pago/${p.id}/marcar-pagado"><button class="btn ghost sm" type="submit" style="padding:7px 13px;font-size:12.5px">Marcar pagado</button></form>`}
      </div>
    </div>`).join('');

  const msgs = (await query(`SELECT * FROM mensajes WHERE alumno_id = $1 ORDER BY created_at ASC`, [req.params.id])).rows;
  const tl = msgs.length ? `<ul class="timeline">${msgs.map(m => `<li class="${m.estado === 'fallido' ? 'fallido' : ''}">
      <div class="meta">${fmt(m.created_at)} · ${esc(m.tipo)} · ${esc(m.canal)} <span class="st ${m.estado}">${m.estado}</span></div>
      <div class="body">${esc(m.error ? '⚠ ' + m.error : m.contenido)}</div></li>`).join('')}</ul>`
    : '<p class="sub">Sin mensajes todavía.</p>';

  const aviso = req.query.creado ? `<p class="pill ok">✓ Alumno dado de alta — ya tiene su plan de 5 pagos.</p>` : '';

  res.send(layout(a.nombre, `
    <h1>${esc(a.nombre)}${a.archivado ? ' <span class="tag">archivado</span>' : ''}</h1>
    <p class="sub">Inscrito el ${fmt(a.fecha_alta)} · curso de ${esc(a.curso)} (${label(a.modalidad)}), inicia el ${fmtDia(a.fecha_inicio)}</p>
    ${aviso}
    <div class="card"><h2 style="margin-top:0">Contacto</h2><div class="kv">
      <div class="k">WhatsApp</div><div>${a.whatsapp ? esc(a.whatsapp_pais + ' ' + a.whatsapp) : '—'}</div>
      <div class="k">Correo</div><div>${a.correo ? esc(a.correo) : '—'}</div>
      <div class="k">Prospecto</div><div>${a.prospecto_id ? `<a href="/admin/prospecto/${a.prospecto_id}">#${a.prospecto_id}</a>` : '— (inscripción directa)'}</div>
    </div>
      <div class="actions">
        <form method="post" action="/admin/alumno/${a.id}/${a.archivado ? 'desarchivar' : 'archivar'}">
          <button class="btn ${a.archivado ? 'ghost' : 'danger'}" type="submit">${a.archivado ? 'Reactivar recordatorios de pago' : 'Archivar (dejar de mandar recordatorios)'}</button>
        </form>
      </div></div>
    <h2>Plan de pagos</h2>
    <div class="pagos">${filasPago}</div>
    <h2>Historial de mensajes</h2><div class="card">${tl}</div>`,
    { back: `/admin/grupo/${a.cohorte_id}`, section: 'alumnos' }));
});

router.post('/alumno/:id/pago/:pagoId/marcar-pagado', requireAuth, async (req, res) => {
  await engine.confirmarPago({ pagoId: req.params.pagoId, metodo: 'manual' });
  res.redirect(`/admin/alumno/${req.params.id}`);
});

router.post('/alumno/:id/archivar', requireAuth, async (req, res) => {
  await query(`UPDATE alumnos SET archivado = true WHERE id = $1`, [req.params.id]);
  await engine.registrarMensajeAlumno(req.params.id, { tipo: 'sistema', canal: 'sistema', estado: 'nota', contenido: 'Archivado desde el panel — ya no recibe recordatorios de pago automáticos.' });
  res.redirect(`/admin/alumno/${req.params.id}`);
});

router.post('/alumno/:id/desarchivar', requireAuth, async (req, res) => {
  await query(`UPDATE alumnos SET archivado = false WHERE id = $1`, [req.params.id]);
  await engine.registrarMensajeAlumno(req.params.id, { tipo: 'sistema', canal: 'sistema', estado: 'nota', contenido: 'Reactivado desde el panel — vuelve a recibir recordatorios de pago automáticos.' });
  res.redirect(`/admin/alumno/${req.params.id}`);
});

module.exports = { router, requireAuth };
