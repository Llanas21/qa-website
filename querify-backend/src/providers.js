// src/providers.js — integraciones externas (WhatsApp, correo, Graph)
// Todas degradan a "simulación" si faltan credenciales, para poder probar el flujo completo.
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

/* --------------------------- Autenticación Graph ------------------------------ */
// Compartida por correo (sendMail) y por la bitácora de sync a Excel/SharePoint.
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

/* ------------------------------- Correo (Graph) ------------------------------- */
// Se envía como el buzón compartido `MAIL_FROM` (ej. noreply@QuerifyAnalytics.onmicrosoft.com)
// vía POST /users/{buzón}/sendMail. Requiere el permiso de aplicación Mail.Send con
// consentimiento de administrador (idealmente restringido a este buzón con una
// Application Access Policy en Exchange Online).
async function sendEmail({ to, tipo, vars }) {
  const { asunto, cuerpo } = tpl.render(tipo, vars);
  if (config.simulate.email) {
    console.info(`[SIMULA correo → ${to}] "${asunto}"`);
    return { ok: true, estado: 'simulado' };
  }
  try {
    const token = await getGraphToken();
    const remitente = config.email.from; // solo el correo, sin "Nombre <...>"
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(remitente)}/sendMail`;
    const body = {
      message: {
        subject: asunto,
        body: { contentType: 'Text', content: cuerpo },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // sendMail responde 202 Accepted sin cuerpo cuando tiene éxito.
    if (res.status !== 202) {
      const data = await res.json().catch(() => ({}));
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, estado: 'fallido', error: `Correo: ${msg}` };
    }
    return { ok: true, estado: 'enviado' };
  } catch (err) {
    return { ok: false, estado: 'fallido', error: `Correo: ${err.message}` };
  }
}

/* -------------------- Bitácora en Excel/SharePoint (Graph) -------------------- */
// Best-effort: nunca bloquea el alta del prospecto. Agrega una fila a una tabla de Excel.
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