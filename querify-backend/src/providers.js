// src/providers.js — integraciones externas (WhatsApp, correo, Graph)
// Todas degradan a "simulación" si faltan credenciales, para poder probar el flujo completo.
const crypto = require('crypto');
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

// Envía un mensaje de TEXTO LIBRE (no plantilla) — para que el operador conteste a
// mano desde el panel admin. WhatsApp solo permite esto dentro de las 24h después
// del último mensaje que la persona mandó (si no, Meta rechaza con un error claro,
// código típico #131047 "re-engagement message" — se deja pasar tal cual en `error`).
async function sendWhatsAppTexto({ pais, numero, texto }) {
  const to = `${(pais || '').replace('+', '')}${numero || ''}`;

  if (config.simulate.whatsapp) {
    console.info(`[SIMULA WhatsApp → ${to}] texto="${texto}"`);
    return { ok: true, estado: 'simulado' };
  }
  try {
    const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
    const body = { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } };
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
    // El correo real que recibe la persona va en HTML (logo, botón, etc. — ver
    // templates.renderHtml). `cuerpo` (texto plano) sigue siendo lo que se
    // guarda en mensajes.contenido para el timeline de /admin, sin cambios ahí.
    const html = tpl.renderHtml(tipo, vars);
    const body = {
      message: {
        subject: asunto,
        body: html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: cuerpo },
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

/* ------------------------ Calendario de Outlook (Graph) ------------------------ */
// Eventos de recordatorio de cada grupo (ver calendario.js), en el calendario
// principal de cada buzón de CALENDARIO_BUZONES. Requiere el permiso de
// aplicación Calendars.ReadWrite (con consentimiento de administrador).
// Simulado: no llama a Graph y regresa un id falso, así el resto del flujo
// (guardar, mover, borrar) se puede probar en local.
async function graphCalendario(method, ruta, body) {
  const token = await getGraphToken();
  for (let intento = 0; intento < 3; intento++) {
    const res = await fetch(`https://graph.microsoft.com/v1.0${ruta}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Graph limita la velocidad por buzón: espera lo que pide y reintenta.
    if (res.status === 429 && intento < 2) {
      await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) || 5) * 1000));
      continue;
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error?.message || `HTTP ${res.status}`) };
  }
}

async function crearEventoCalendario(buzon, evento) {
  if (config.simulate.calendario) return { ok: true, id: `simulado-${crypto.randomUUID()}` };
  const r = await graphCalendario('POST', `/users/${encodeURIComponent(buzon)}/events`, evento);
  return r.ok ? { ok: true, id: r.data.id } : { ok: false, status: r.status, error: r.error };
}

// `noExiste`: lo borraron a mano en Outlook (o era un id simulado) — quien
// llama lo vuelve a crear.
async function actualizarEventoCalendario(buzon, id, evento) {
  if (config.simulate.calendario) return { ok: true };
  const r = await graphCalendario('PATCH', `/users/${encodeURIComponent(buzon)}/events/${encodeURIComponent(id)}`, evento);
  return r.ok ? { ok: true } : { ok: false, status: r.status, noExiste: r.status === 404 || r.status === 400, error: r.error };
}

async function borrarEventoCalendario(buzon, id) {
  if (config.simulate.calendario) return { ok: true };
  const r = await graphCalendario('DELETE', `/users/${encodeURIComponent(buzon)}/events/${encodeURIComponent(id)}`);
  return r.ok || r.status === 404 || r.status === 400 ? { ok: true } : { ok: false, status: r.status, error: r.error };
}

/* --------------------------------- Stripe -------------------------------------- */
// Checkout Sessions hospedadas por Stripe para cada pago de $500 MXN (el pago 1 al
// apartar el lugar, y los pagos 2-5 que cobra el cron). Si falta STRIPE_SECRET_KEY
// se SIMULA: no se llama a Stripe, y quien invoque esto decide cómo continuar el
// flujo sin una sesión real (ver engine.iniciarInscripcion / revisarPagosPorVencer).
let stripeClient = null;
function getStripe() {
  if (!stripeClient) stripeClient = require('stripe')(config.stripe.secretKey);
  return stripeClient;
}

// `monto` en MXN (no en centavos). `metadata` viaja en la sesión (y en su
// PaymentIntent) y es lo único que el webhook tiene para saber a qué pago
// corresponde cuando Stripe lo confirme. Con `customerId` la página de pago
// ofrece también transferencia SPEI a la CLABE fija de ese cliente (ver
// abajo); sin él, solo tarjeta.
async function crearCheckoutSession({ descripcion, monto, metadata, urlExito, urlCancelado, customerId = null }) {
  if (config.simulate.stripe) {
    console.info(`[SIMULA Stripe] checkout $${monto} MXN — ${descripcion}`);
    return { ok: true, simulado: true, url: null, sessionId: `simulado_${Date.now()}` };
  }
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(customerId ? {
        customer: customerId,
        payment_method_types: ['card', 'customer_balance'],
        payment_method_options: { customer_balance: MX_SPEI },
      } : { payment_method_types: ['card'] }),
      line_items: [{
        price_data: {
          currency: config.stripe.currency,
          unit_amount: Math.round(monto * 100),
          product_data: { name: descripcion },
        },
        quantity: 1,
      }],
      metadata,
      payment_intent_data: { metadata },
      locale: 'es-419',
      success_url: urlExito,
      cancel_url: urlCancelado,
    });
    return { ok: true, simulado: false, url: session.url, sessionId: session.id };
  } catch (err) {
    return { ok: false, error: `Stripe: ${err.message}` };
  }
}

/* ------------- Transferencias SPEI (CLABE fija por alumno, saldo del cliente) ------------- */
// Cada alumno es un Customer de Stripe con una CLABE propia: lo que transfiere
// cae en el "saldo de caja" de ese Customer, así Stripe sabe de quién es aunque
// todos manden el mismo monto. Si eligió "transferencia" en la página de pago,
// Stripe aplica solo ese saldo al pago abierto (y llega
// checkout.session.async_payment_succeeded); si transfirió directo a su CLABE
// sin pago abierto, lo aplica engine.procesarTransferencia. En modo de prueba
// Stripe da CLABEs no válidas (y no siempre únicas); en producción son reales.
const MX_SPEI = { funding_type: 'bank_transfer', bank_transfer: { type: 'mx_bank_transfer' } };

// Reutiliza el cliente de Stripe de ese correo si ya existe (así alguien que
// abre el pago dos veces, o vuelve por otro curso, conserva la misma CLABE).
async function clienteStripe({ nombre, correo }) {
  const stripe = getStripe();
  if (correo) {
    const { data } = await stripe.customers.list({ email: correo, limit: 1 });
    if (data[0]) return data[0].id;
  }
  return (await stripe.customers.create({ name: nombre, email: correo || undefined })).id;
}

// CLABE del cliente (Stripe devuelve siempre la misma para el mismo cliente).
async function datosTransferencia(customerId) {
  const fi = await getStripe().customers.createFundingInstructions(customerId, { currency: 'mxn', ...MX_SPEI });
  const spei = fi.bank_transfer.financial_addresses.find(a => a.type === 'spei')?.spei;
  if (!spei) throw new Error('Stripe no devolvió una CLABE.');
  return { clabe: spei.clabe, banco: spei.bank_name, titular: spei.account_holder_name };
}

async function crearClabe({ nombre, correo }) {
  if (config.simulate.stripe) return { ok: false, error: 'Stripe no está configurado.' };
  try {
    const customerId = await clienteStripe({ nombre, correo });
    return { ok: true, customerId, ...(await datosTransferencia(customerId)) };
  } catch (err) {
    return { ok: false, error: `Stripe: ${err.message}` };
  }
}

// Estado de una sesión de pago, para la página de gracias y el correo de
// "datos para transferir": si el alumno eligió transferencia, la sesión se
// completa SIN pagar y su PaymentIntent trae los datos (CLABE, monto, liga
// de Stripe con las instrucciones) en next_action.
async function estadoCheckout(sessionId) {
  const s = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  const pi = s.payment_intent;
  const instr = pi?.next_action?.display_bank_transfer_instructions;
  const spei = instr?.financial_addresses?.find(a => a.type === 'spei')?.spei;
  return {
    pagado: s.payment_status === 'paid',
    metadata: s.metadata || {},
    transferencia: instr && spei ? {
      monto: instr.amount_remaining / 100, clabe: spei.clabe, banco: spei.bank_name,
      titular: spei.account_holder_name, url: instr.hosted_instructions_url,
    } : null,
  };
}

// Pagos por transferencia que el cliente dejó abiertos ("esperando que
// transfiera"). Stripe les aplica solo lo que llegue a su CLABE.
async function transferenciasAbiertas(customerId) {
  const { data } = await getStripe().paymentIntents.list({ customer: customerId, limit: 50 });
  return data.filter(pi => pi.status === 'requires_action' && pi.next_action?.type === 'display_bank_transfer_instructions');
}

// Cancela los pagos por transferencia abiertos que cumplan `filtro` (por
// metadata). Se usa cuando un pago ya se cubrió por otra vía, o al abrir un
// pago nuevo de inscripción: un pago abierto que ya no corresponde se
// tragaría la siguiente transferencia del alumno.
async function cancelarTransferenciasAbiertas(customerId, filtro) {
  const stripe = getStripe();
  for (const pi of await transferenciasAbiertas(customerId)) {
    if (filtro(pi.metadata || {})) await stripe.paymentIntents.cancel(pi.id).catch(err => console.error(`[stripe] no se pudo cancelar ${pi.id}: ${err.message}`));
  }
}

// Saldo de transferencias recibidas y aún no aplicadas a ningún pago, en MXN.
async function saldoTransferencias(customerId) {
  const cb = await getStripe().customers.retrieveCashBalance(customerId);
  return (cb.available?.mxn || 0) / 100;
}

// Cubre un pago con el saldo del cliente: un PaymentIntent que se paga al
// instante desde ese saldo. Si no alcanza, Stripe lo dejaría abierto
// "esperando fondos" y se tragaría solo la siguiente transferencia sin que
// el sistema se enterara — por eso se cancela si no quedó pagado.
async function cobrarDeSaldo({ customerId, monto, descripcion, metadata }) {
  const stripe = getStripe();
  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(monto * 100), currency: 'mxn', customer: customerId,
      payment_method_types: ['customer_balance'],
      payment_method_data: { type: 'customer_balance' },
      payment_method_options: { customer_balance: MX_SPEI },
      confirm: true, description: descripcion, metadata,
    });
    if (pi.status === 'succeeded') return { ok: true, paymentIntentId: pi.id };
    await stripe.paymentIntents.cancel(pi.id).catch(() => {});
    return { ok: false, error: `PaymentIntent quedó en ${pi.status}` };
  } catch (err) {
    return { ok: false, error: `Stripe: ${err.message}` };
  }
}

// Solo modo de prueba: simula que llegó una transferencia a la CLABE del
// cliente (en prueba no existe SPEI real). Stripe manda el mismo webhook que
// con una transferencia de verdad, así que se prueba el flujo completo.
const stripeEnPrueba = () => (config.stripe.secretKey || '').startsWith('sk_test_');
async function simularTransferencia({ customerId, monto }) {
  if (!stripeEnPrueba()) throw new Error('Solo disponible con Stripe en modo de prueba.');
  await getStripe().testHelpers.customers.fundCashBalance(customerId, { amount: Math.round(monto * 100), currency: 'mxn' });
}

// Verifica la firma del webhook con el secreto de Stripe. `rawBody` debe ser el
// cuerpo SIN parsear (Buffer) — ver el middleware express.raw() en server.js.
// En modo simulación (o si no hay STRIPE_WEBHOOK_SECRET) no hay firma real que
// verificar: se confía en el cuerpo tal cual, solo para pruebas locales.
function verificarEventoStripe(rawBody, firma) {
  if (config.simulate.stripe || !config.stripe.webhookSecret) {
    return JSON.parse(rawBody.toString());
  }
  return getStripe().webhooks.constructEvent(rawBody, firma, config.stripe.webhookSecret);
}

module.exports = {
  sendWhatsAppTemplate, sendWhatsAppTexto, sendEmail, syncProspecto, crearCheckoutSession, verificarEventoStripe,
  crearClabe, clienteStripe, datosTransferencia, estadoCheckout, transferenciasAbiertas, cancelarTransferenciasAbiertas,
  saldoTransferencias, cobrarDeSaldo, stripeEnPrueba, simularTransferencia,
  crearEventoCalendario, actualizarEventoCalendario, borrarEventoCalendario,
};