// src/templates.js — correos a alumnos: inscripción, cobro de pagos, transferencia y certificado
// Variables: {{1}} nombre, {{2}} curso, {{3}} número de pago (solo "pago") o
// liga de descarga (solo "certificado"),
// {{4}} monto y {{5}} liga de pago (solo "pago").
// "transferencia" (datos para pagar por SPEI tras elegirlo en la página de
// pago) usa las suyas: {{3}} concepto, {{4}} monto, {{5}} CLABE, {{6}} banco,
// {{7}} titular y {{8}} liga de Stripe con las instrucciones.
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
  pago:        'Pago {{3}}/5 por vencer — curso de {{2}}',
  inscripcion: '¡Tu lugar quedó apartado! — curso de {{2}}',
  certificado: '¡Tu certificado de {{2}} ya está listo! 🎓',
  transferencia: 'Datos para tu transferencia — curso de {{2}}',
};

const cuerpo = {
  pago: `Hola {{1}}, tu pago {{3}}/5 del curso de {{2}} está próximo a vencer.

💳 Monto: $ {{4}} MXN
🔗 Liga de pago segura (Stripe): {{5}}
Ahí puedes pagar con tarjeta o con transferencia bancaria.

En cuanto lo confirmes, tu lugar sigue asegurado sin problema. Cualquier duda, aquí estoy 🙌`,

  inscripcion: `¡Hola {{1}}! 🎉 Tu lugar en el curso de {{2}} quedó apartado — recibimos tu primer pago de $500 MXN.

Conforme se acerque la fecha de tu primera clase, tu asesor se pondrá en contacto contigo para darte la bienvenida y contarte los detalles del curso, tu horario y las fechas de los siguientes 4 pagos.

¡Bienvenido a Querify Analytics! 🙌`,

  certificado: `¡Hola {{1}}! 🎓 Terminaste el curso de {{2}} — felicidades, el esfuerzo valió la pena.

Aquí puedes descargar tu certificado:
🔗 {{3}}

¡Gracias por tomar el curso con Querify Analytics, esperamos verte pronto en otro! 🙌`,

  transferencia: `Hola {{1}}, aquí están los datos para tu transferencia del curso de {{2}} ({{3}}):

💳 Monto: $ {{4}} MXN
🏦 CLABE: {{5}}
Banco: {{6}}
A nombre de: {{7}}

Transfiere el monto exacto. En cuanto llegue, tu pago se registra solo. Esta CLABE es solo tuya: guárdala para tus siguientes pagos.

Instrucciones completas: {{8}}`,
};

// Cuántos parámetros usa cada plantilla (para armar el componente body de Meta)
const numVars = { pago: 5, inscripcion: 2, certificado: 3, transferencia: 8 };

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
  pago: (v) => `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${T.text}">Hola ${esc(v[0])}, tu pago <b>${esc(v[2])}/5</b> del curso de <b>${esc(v[1])}</b> está próximo a vencer.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.surface2};border:1px solid ${T.line};border-radius:10px;margin:0 0 22px"><tr><td style="padding:18px 20px;text-align:center">
      <p style="margin:0 0 4px;font-size:13px;color:${T.muted}">Monto a pagar</p>
      <p style="margin:0 0 16px;font-size:28px;font-weight:700;color:${T.ink}">$${esc(v[3])} <span style="font-size:15px;font-weight:400;color:${T.muted}">MXN</span></p>
      ${boton('Pagar ahora', v[4], 'center')}
    </td></tr></table>
    <p style="margin:0;font-size:14px;line-height:1.6;color:${T.muted}">Puedes pagar con tarjeta o con transferencia bancaria (SPEI). Pago seguro procesado por Stripe. En cuanto se confirme, tu lugar sigue asegurado sin problema. Cualquier duda, aquí estoy 🙌</p>`,

  inscripcion: (v) => `
    <p style="margin:0 0 4px;font-size:34px">🎉</p>
    <p style="margin:0 0 16px;font-size:17px;line-height:1.5;color:${T.ink}"><b>¡Hola ${esc(v[0])}!</b></p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.okSoft};border-radius:10px;margin:0 0 20px"><tr><td style="padding:16px 18px">
      <p style="margin:0;font-size:15px;line-height:1.6;color:${T.okInk}">Tu lugar en el curso de <b>${esc(v[1])}</b> quedó apartado — recibimos tu primer pago de <b>$500 MXN</b>.</p>
    </td></tr></table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${T.text}">Conforme se acerque la fecha de tu primera clase, tu asesor se pondrá en contacto contigo para darte la bienvenida y contarte los detalles del curso, tu horario y las fechas de los siguientes 4 pagos.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${T.text}">¡Bienvenido a Querify Analytics! 🙌</p>`,

  certificado: (v) => `
    <p style="margin:0 0 4px;font-size:34px">🎓</p>
    <p style="margin:0 0 16px;font-size:17px;line-height:1.5;color:${T.ink}"><b>¡Hola ${esc(v[0])}!</b></p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.okSoft};border-radius:10px;margin:0 0 22px"><tr><td style="padding:16px 18px;text-align:center">
      <p style="margin:0;font-size:15px;line-height:1.6;color:${T.okInk}">Terminaste el curso de <b>${esc(v[1])}</b> — felicidades, el esfuerzo valió la pena.</p>
      ${boton('Descargar certificado', v[2], 'center')}
    </td></tr></table>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${T.text}">Gracias por tomar el curso con Querify Analytics, esperamos verte pronto en otro 🙌</p>`,
};

// Agrupa la CLABE (3-3-11-1) para que se lea y se dicte fácil.
const clabeFmt = c => String(c ?? '').replace(/^(\d{3})(\d{3})(\d{11})(\d)$/, '$1 $2 $3 $4');
contenidoHtml.transferencia = (v) => `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${T.text}">Hola ${esc(v[0])}, aquí están los datos para tu transferencia del curso de <b>${esc(v[1])}</b> (${esc(v[2])}):</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${T.surface2};border:1px solid ${T.line};border-radius:10px;margin:0 0 22px"><tr><td style="padding:18px 20px">
      <p style="margin:0 0 4px;font-size:13px;color:${T.muted}">Monto a transferir</p>
      <p style="margin:0 0 14px;font-size:26px;font-weight:700;color:${T.ink}">$${esc(v[3])} <span style="font-size:15px;font-weight:400;color:${T.muted}">MXN</span></p>
      <p style="margin:0 0 4px;font-size:13px;color:${T.muted}">CLABE</p>
      <p style="margin:0 0 14px;font-size:20px;font-weight:700;letter-spacing:.5px;color:${T.ink};font-family:Consolas,'Courier New',monospace">${esc(clabeFmt(v[4]))}</p>
      <p style="margin:0;font-size:14.5px;line-height:1.7;color:${T.text}">Banco: <b>${esc(v[5])}</b><br>A nombre de: <b>${esc(v[6])}</b></p>
    </td></tr></table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${T.text}">Transfiere el monto exacto. En cuanto llegue, tu pago se registra solo. <b>Esta CLABE es solo tuya:</b> guárdala para tus siguientes pagos.</p>
    ${v[7] ? boton('Ver instrucciones', v[7]) : ''}`;

// Devuelve el HTML completo listo para mandar (el que de verdad ve la persona).
function renderHtml(tipo, vars) {
  const { asunto: asuntoTxt } = render(tipo, vars);
  const gen = contenidoHtml[tipo];
  if (!gen) return null;
  return shell({ preheader: asuntoTxt, contenido: gen(vars) });
}

module.exports = { render, renderHtml, metaBodyParams, numVars };
