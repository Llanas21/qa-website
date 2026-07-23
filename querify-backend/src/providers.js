// src/providers.js — integraciones externas (WhatsApp, correo, Graph)
// Todas degradan a "simulación" si faltan credenciales, para poder probar el flujo completo.
const nodemailer = require('nodemailer');
const { config } = require('./db');
const tpl = require('./templates');

/* ------------------------- WhatsApp (Meta Cloud API) ------------------------- */
// Envía un mensaje de PLANTILLA. `to` = dígitos con lada de país, sin '+'.
async function sendWhatsAppTemplate({ pais, numero, tipo, vars }) {
  const to = `${(pais || '').replace('+', '')}${numero || ''}`;
  const templateName = config.whatsapp.templates[tipo];

  if (config.simulate.whatsapp) {
    console.info(`[SIMULA WhatsApp → ${to}] plantilla="${templateName}" vars=${JSON.stringify(vars)}`);
    return { ok: true, estado: 'simulado' };
  }
  try {
    const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: config.whatsapp.lang },
        components: [{ type: 'body', parameters: tpl.metaBodyParams(tipo, vars) }],
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, estado: 'fallido', error: `WhatsApp: ${msg}` };
    }
    return { ok: true, estado: 'enviado' };
  } catch (err) {
    return { ok: false, estado: 'fallido', error: `WhatsApp: ${err.message}` };
  }
}

/* ------------------------------- Correo (SMTP) ------------------------------- */
let transporter = null;
function getTransporter() {
  if (!transporter && !config.simulate.email) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return transporter;
}

async function sendEmail({ to, tipo, vars }) {
  const { asunto, cuerpo } = tpl.render(tipo, vars);
  if (config.simulate.email) {
    console.info(`[SIMULA correo → ${to}] "${asunto}"`);
    return { ok: true, estado: 'simulado' };
  }
  try {
    await getTransporter().sendMail({ from: config.email.from, to, subject: asunto, text: cuerpo });
    return { ok: true, estado: 'enviado' };
  } catch (err) {
    return { ok: false, estado: 'fallido', error: `Correo: ${err.message}` };
  }
}

/* -------------------- Bitácora en Excel/SharePoint (Graph) -------------------- */
// Best-effort: nunca bloquea el alta del prospecto. Agrega una fila a una tabla de Excel.
let graphToken = { value: null, exp: 0 };
async function getGraphToken() {
  if (graphToken.value && Date.now() < graphToken.exp) return graphToken.value;
  const url = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, { method: 'POST', body: params });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || 'token Graph');
  graphToken = { value: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return graphToken.value;
}

async function syncProspecto(p) {
  if (config.simulate.sync) {
    console.info(`[OMITE sync SharePoint] prospecto #${p.id} (${p.nombre})`);
    return;
  }
  try {
    const token = await getGraphToken();
    const base = `https://graph.microsoft.com/v1.0/drives/${config.graph.driveId}/items/${config.graph.workbookItemId}` +
                 `/workbook/tables/${encodeURIComponent(config.graph.tableName)}/rows`;
    // Orden de columnas esperado en la tabla de Excel:
    const fila = [[
      p.id, p.fecha_registro, p.nombre, p.curso,
      p.telefono ? `${p.telefono_pais} ${p.telefono}` : '', p.correo || '',
      p.canal, p.estado_secuencia, p.paso_actual,
    ]];
    const res = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: fila }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn(`[sync SharePoint] no se pudo agregar fila: ${res.status} ${t}`);
    }
  } catch (err) {
    console.warn(`[sync SharePoint] error (no bloquea): ${err.message}`);
  }
}

module.exports = { sendWhatsAppTemplate, sendEmail, syncProspecto };
