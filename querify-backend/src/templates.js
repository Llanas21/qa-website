// src/templates.js — contenido de los mensajes de la secuencia + cobro de pagos
// Variables: {{1}} nombre, {{2}} curso, {{3}} fecha de inicio (solo "valor") o
// número de pago (solo "pago"), {{4}} monto y {{5}} liga de pago (solo "pago").
// Para WhatsApp se envían como PLANTILLAS de Meta por nombre + parámetros
// (código dejado intacto aunque ya no se use — ver ESTADO.md, sitio solo correo
// desde el 1 oct 2026). Para correo / modo simulación se usa `render()` (texto
// plano, también lo que se guarda en el timeline de /admin) y `renderHtml()`
// (el correo real que recibe la persona — ver abajo).

const SITIO = 'https://querifyanalytics.com';
const LOGO = `${SITIO}/assets/img/querify-logo.png`;

// Mismos tokens de color que :root en querify-web/assets/css/styles.css —
// para que el correo se vea como una extensión del sitio, no como una
// plantilla genérica de newsletter. Si la paleta del sitio cambia, cambiar
// aquí también (son los mismos valores, copiados a mano porque el email no
// puede leer el CSS del sitio).
const T = {
  bg: '#F6F9FD', surface: '#FFFFFF', surface2: '#EEF3FB',
  line: '#E1E9F4', ink: '#0F1E33', text: '#12233D',
  muted: '#51617C', muted2: '#7A88A0',
  accentStrong: '#2563EB', accentInk: '#1D4ED8', accentSoft: '#E8F0FE',
  onAccent: '#FFFFFF',
  okSoft: '#F0FDF4', okInk: '#166534',
};

const asunto = {
  bienvenida:  'Información del curso de {{2}} — Querify Analytics',
  recordatorio:'¿Te quedó alguna duda sobre el curso de {{2}}?',
  valor:       'Cupo limitado — curso de {{2}} en Querify Analytics',
  cierre:      'Seguimos aquí cuando estés listo — {{2}}',
  pago:        'Pago {{3}}/5 por vencer — curso de {{2}}',
  inscripcion: '¡Tu lugar quedó apartado! — curso de {{2}}',
};

const cuerpo = {
  bienvenida: `¡Hola {{1}}! 👋 Gracias por tu interés en el curso de {{2}} de Querify Analytics.

Te cuento lo esencial:
📚 30 horas de capacitación 100% en vivo por Microsoft Teams
🎓 Nivel: de cero a experto
👥 Cupo limitado a 10 alumnos, para un mejor seguimiento
📜 Certificado con valor curricular al finalizar

💰 Inversión total: $2,500 MXN, en 5 pagos de $500. Puedes apartar tu lugar con el primer pago y liquidar el resto cada 2 semanas a lo largo del curso.

¿Tienes dudas o quieres conocer los horarios disponibles (entre semana o sábado)? Aquí estoy para ayudarte 🙌`,

  recordatorio: `Hola {{1}}, ¿cómo estás? Quería saber si te quedó alguna duda sobre el curso de {{2}}. Con gusto te platico más sobre los horarios disponibles o cómo apartar tu lugar cuando gustes 😊`,

  valor: `Hola {{1}}, te comparto que el cupo del curso de {{2}} es limitado a solo 10 alumnos por grupo, para poder darte un seguimiento más cercano durante las clases.

La próxima generación arranca el {{3}} — si te interesa asegurar tu lugar, recuerda que puedes apartarlo con el primer pago de $500 MXN (son 5 pagos de $500 en total).

Cualquier duda, aquí sigo 🙌`,

  cierre: `Hola {{1}}, no quiero ser inoportuno, así que este será mi último mensaje por ahora 🙂

El curso de {{2}} sigue disponible cuando estés listo — solo escríbeme y con gusto retomamos la plática. ¡Éxito en lo que decidas! 🚀`,

  pago: `Hola {{1}}, tu pago {{3}}/5 del curso de {{2}} está próximo a vencer.

💳 Monto: $ {{4}} MXN
🔗 Liga de pago segura (Stripe): {{5}}

En cuanto lo confirmes, tu lugar sigue asegurado sin problema. Cualquier duda, aquí estoy 🙌`,

  inscripcion: `¡Hola {{1}}! 🎉 Tu lugar en el curso de {{2}} quedó apartado — recibimos tu primer pago de $500 MXN.

Conforme se acerque la fecha de tu primera clase, tu asesor se pondrá en contacto contigo para darte la bienvenida y contarte los detalles del curso, tu horario y las fechas de los siguientes 4 pagos.

¡Bienvenido a Querify Analytics! 🙌`,
};

// Cuántos parámetros usa cada plantilla (para armar el componente body de Meta)
const numVars = { bienvenida: 2, recordatorio: 2, valor: 3, cierre: 2, pago: 5, inscripcion: 2 };

// {{N}} genérico (antes solo soportaba {{1}}..{{3}}) para poder agregar la
// plantilla de "pago" sin tocar el reemplazo de las 4 plantillas existentes.
function fill(str, vars) {
  return str.replace(/\{\{(\d+)\}\}/g, (_, i) => vars[Number(i) - 1] ?? '');
}

// Devuelve el texto y asunto ya renderizados (correo / simulación / lo que se
// guarda en mensajes.contenido — el timeline de /admin siempre se ve en texto
// plano, nunca con el markup del HTML de abajo).
function render(tipo, vars) {
  return { asunto: fill(asunto[tipo] || '', vars), cuerpo: fill(cuerpo[tipo] || '', vars) };
}

// Devuelve los parámetros del body para la plantilla de Meta
function metaBodyParams(tipo, vars) {
  return vars.slice(0, numVars[tipo] || 0).map(v => ({ type: 'text', text: String(v ?? '') }));
}

/* ----------------------------- versión HTML ----------------------------- */
// Correo real que recibe la persona: cabecera con logo, botón cuando aplica,
// pie de página con la marca. Todo con estilos en línea (inline) a propósito
// — los clientes de correo (Outlook sobre todo) ignoran o rompen <style> en
// el <head>, así que el único layout confiable es tabla + estilos inline.
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// Convierte texto plano con \n\n (párrafos) y \n (líneas sueltas) a <p>.
const parrafos = texto => texto.split('\n\n').map(p =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${T.text}">${esc(p).replace(/\n/g, '<br>')}</p>`
).join('');

// Botón "a prueba de balas" para correo: <a> con padding/color en línea, sin
// depender de CSS externo ni de <button> (muchos clientes lo ignoran). Píldora
// (border-radius:999px) para igualar el .btn del sitio público, no un botón
// rectangular genérico de correo.
function boton(texto, href, align = 'left') {
  // <a style="display:inline-block"> dentro de un <div style="text-align">
  // a propósito — más confiable entre clientes (Gmail, Apple Mail, Outlook)
  // que centrar una <table> con el atributo align, que los motores modernos
  // ignoran por ser obsoleto.
  return `<div style="text-align:${align};margin:8px 0 4px"><a href="${href}" target="_blank" style="display:inline-block;padding:14px 26px;font-size:15.5px;font-weight:600;color:${T.onAccent};background:${T.accentStrong};text-decoration:none;border-radius:999px;font-family:'Segoe UI',Arial,sans-serif">${esc(texto)}</a></div>`;
}

function shell({ preheader = '', contenido }) {
  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Querify Analytics</title>
</head>
<body style="margin:0;padding:0;background:${T.bg};font-family:'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.bg};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${T.surface};border-radius:18px;overflow:hidden;border:1px solid ${T.line}">
        <tr><td style="background:${T.surface};padding:28px 32px 22px;text-align:center;border-bottom:1px solid ${T.line}">
          <img src="${LOGO}" width="40" height="40" alt="Querify Analytics" style="display:block;margin:0 auto 10px;border:0">
          <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:19px;font-weight:700;color:${T.ink};letter-spacing:-0.3px;line-height:1">Querify</div>
          <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:lowercase;color:${T.muted2};margin-top:5px">analytics</div>
        </td></tr>
        <tr><td style="padding:32px">
          ${contenido}
        </td></tr>
        <tr><td style="padding:20px 32px;background:${T.surface2};border-top:1px solid ${T.line}">
          <p style="margin:0 0 4px;font-size:12.5px;line-height:1.6;color:${T.muted}">Querify Analytics — cursos en vivo de Excel, SQL Server, Power BI y Python.</p>
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:${T.muted2}">Te escribimos porque dejaste tus datos en <a href="${SITIO}" style="color:${T.muted}">querifyanalytics.com</a>. Responde este correo si no quieres recibir más mensajes.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const contenidoHtml = {
  bienvenida: (v) => `
    <p style="margin:0 0 16px;font-size:17px;line-height:1.5;color:${T.ink}"><b>¡Hola ${esc(v[0])}! 👋</b></p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${T.text}">Gracias por tu interés en el curso de <b>${esc(v[1])}</b> de Querify Analytics. Te cuento lo esencial:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;width:100%">
      ${[
        ['📚', '30 horas de capacitación 100% en vivo por Microsoft Teams'],
        ['🎓', 'Nivel: de cero a experto'],
        ['👥', 'Cupo limitado a 10 alumnos, para un mejor seguimiento'],
        ['📜', 'Certificado con valor curricular al finalizar'],
      ].map(([icono, texto]) => `
      <tr>
        <td style="width:28px;vertical-align:top;font-size:16px;padding:4px 0">${icono}</td>
        <td style="font-size:14.5px;line-height:1.5;color:${T.muted};padding:4px 0">${texto}</td>
      </tr>`).join('')}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.accentSoft};border-radius:10px;margin:0 0 22px"><tr><td style="padding:14px 18px">
      <p style="margin:0;font-size:14.5px;line-height:1.5;color:${T.accentInk}"><b>💰 Inversión total: $2,500 MXN</b>, en 5 pagos de $500. Puedes apartar tu lugar con el primer pago y liquidar el resto cada 2 semanas.</p>
    </td></tr></table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${T.text}">¿Tienes dudas o quieres conocer los horarios disponibles (entre semana o sábado)? Aquí estoy para ayudarte 🙌</p>
    ${boton('Apartar mi lugar', `${SITIO}/cursos/inscripcion.html`)}`,

  recordatorio: (v) => `
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${T.text}">Hola ${esc(v[0])}, ¿cómo estás? Quería saber si te quedó alguna duda sobre el curso de <b>${esc(v[1])}</b>. Con gusto te platico más sobre los horarios disponibles o cómo apartar tu lugar cuando gustes 😊</p>
    ${boton('Apartar mi lugar', `${SITIO}/cursos/inscripcion.html`)}`,

  valor: (v) => `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${T.text}">Hola ${esc(v[0])}, te comparto que el cupo del curso de <b>${esc(v[1])}</b> es limitado a solo <b>10 alumnos por grupo</b>, para poder darte un seguimiento más cercano durante las clases.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.accentSoft};border-radius:10px;margin:0 0 20px"><tr><td style="padding:14px 18px">
      <p style="margin:0;font-size:14.5px;line-height:1.5;color:${T.accentInk}">📅 La próxima generación arranca el <b>${esc(v[2])}</b> — puedes asegurar tu lugar con el primer pago de $500 MXN (5 pagos de $500 en total).</p>
    </td></tr></table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${T.text}">Cualquier duda, aquí sigo 🙌</p>
    ${boton('Apartar mi lugar', `${SITIO}/cursos/inscripcion.html`)}`,

  cierre: (v) => `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${T.text}">Hola ${esc(v[0])}, no quiero ser inoportuno, así que este será mi último mensaje por ahora 🙂</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:${T.text}">El curso de <b>${esc(v[1])}</b> sigue disponible cuando estés listo — solo escríbeme y con gusto retomamos la plática. ¡Éxito en lo que decidas! 🚀</p>
    ${boton('Ver los cursos', SITIO)}`,

  pago: (v) => `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${T.text}">Hola ${esc(v[0])}, tu pago <b>${esc(v[2])}/5</b> del curso de <b>${esc(v[1])}</b> está próximo a vencer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.surface2};border:1px solid ${T.line};border-radius:10px;margin:0 0 22px"><tr><td style="padding:18px 20px;text-align:center">
      <p style="margin:0 0 4px;font-size:13px;color:${T.muted}">Monto a pagar</p>
      <p style="margin:0 0 16px;font-size:28px;font-weight:700;color:${T.ink}">$${esc(v[3])} <span style="font-size:15px;font-weight:400;color:${T.muted}">MXN</span></p>
      ${boton('Pagar ahora', v[4], 'center')}
    </td></tr></table>
    <p style="margin:0;font-size:14px;line-height:1.6;color:${T.muted}">Pago seguro procesado por Stripe. En cuanto se confirme, tu lugar sigue asegurado sin problema. Cualquier duda, aquí estoy 🙌</p>`,

  inscripcion: (v) => `
    <p style="margin:0 0 4px;font-size:34px">🎉</p>
    <p style="margin:0 0 16px;font-size:17px;line-height:1.5;color:${T.ink}"><b>¡Hola ${esc(v[0])}!</b></p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.okSoft};border-radius:10px;margin:0 0 20px"><tr><td style="padding:16px 18px">
      <p style="margin:0;font-size:15px;line-height:1.6;color:${T.okInk}">Tu lugar en el curso de <b>${esc(v[1])}</b> quedó apartado — recibimos tu primer pago de <b>$500 MXN</b>.</p>
    </td></tr></table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${T.text}">Conforme se acerque la fecha de tu primera clase, tu asesor se pondrá en contacto contigo para darte la bienvenida y contarte los detalles del curso, tu horario y las fechas de los siguientes 4 pagos.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${T.text}">¡Bienvenido a Querify Analytics! 🙌</p>`,
};

// Devuelve el HTML completo listo para mandar (el que de verdad ve la persona).
function renderHtml(tipo, vars) {
  const { asunto: asuntoTxt } = render(tipo, vars);
  const gen = contenidoHtml[tipo];
  if (!gen) return null;
  return shell({ preheader: asuntoTxt, contenido: gen(vars) });
}

module.exports = { render, renderHtml, metaBodyParams, numVars };
