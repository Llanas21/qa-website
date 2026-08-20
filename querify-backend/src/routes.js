// src/routes.js — API pública (formulario, inscripción) + webhooks (WhatsApp, Stripe)
const express = require('express');
const { config, query } = require('./db');
const engine = require('./engine');
const providers = require('./providers');

const router = express.Router();

/* --------------------- POST /api/leads (formulario) --------------------- */
router.post('/api/leads', async (req, res) => {
  const b = req.body || {};

  // Honeypot: si el campo trampa viene lleno, es un bot → descartamos en silencio (200).
  if (typeof b.empresa === 'string' && b.empresa.trim() !== '') {
    return res.json({ ok: true });
  }

  // Validación server-side (nunca confiamos solo en el frontend)
  const nombre = (b.nombre || '').toString().trim();
  const correo = (b.correo || '').toString().trim();
  const numero = (b.whatsapp?.numero || '').toString().replace(/\D/g, '');
  const pais = (b.whatsapp?.pais || '').toString().trim() || null;

  if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'Nombre requerido.' });

  const correoOk = correo === '' ? false : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
  const telOk = numero === '' ? false : (numero.length >= 7 && numero.length <= 15);
  if (correo !== '' && !correoOk) return res.status(400).json({ ok: false, error: 'Correo inválido.' });
  if (!telOk && !(correoOk && correo !== '')) {
    return res.status(400).json({ ok: false, error: 'Deja un WhatsApp o un correo válido.' });
  }

  try {
    const data = {
      nombre,
      curso: (b.curso || 'Aún no decido').toString(),
      whatsapp: telOk ? { pais, numero } : null,
      correo: correoOk ? correo : null,
      origen: (b.origen || 'sitio_web').toString(),
    };
    const { action, prospecto } = await engine.altaProspecto(data);

    // Responder de inmediato (flujo asíncrono) y disparar bienvenida + sync en segundo plano.
    res.json({ ok: true, id: prospecto.id, resultado: action });
    engine.afterIntake(prospecto, action); // sin await a propósito
  } catch (err) {
    console.error('[POST /api/leads]', err.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Error del servidor.' });
  }
});

/* --------------- GET /api/cohortes/:curso (selector de inscripción) --------------- */
router.get('/api/cohortes/:curso', async (req, res) => {
  try {
    const curso = req.params.curso.toString();
    const cohortes = await engine.cohortesDisponibles(curso);
    res.json({ ok: true, cohortes });
  } catch (err) {
    console.error('[GET /api/cohortes]', err.message);
    res.status(500).json({ ok: false, error: 'Error del servidor.' });
  }
});

/* --------------------- POST /api/inscripcion (apartar lugar) --------------------- */
router.post('/api/inscripcion', async (req, res) => {
  const b = req.body || {};

  // Mismo honeypot que /api/leads.
  if (typeof b.empresa === 'string' && b.empresa.trim() !== '') {
    return res.json({ ok: true });
  }

  const nombre = (b.nombre || '').toString().trim();
  const correo = (b.correo || '').toString().trim();
  const numero = (b.whatsapp?.numero || '').toString().replace(/\D/g, '');
  const pais = (b.whatsapp?.pais || '').toString().trim() || null;
  const cohorteId = Number(b.cohorteId);
  const prospectoId = b.prospectoId ? Number(b.prospectoId) : null;

  if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'Nombre requerido.' });
  if (!Number.isInteger(cohorteId) || cohorteId <= 0) return res.status(400).json({ ok: false, error: 'Elige una fecha de inicio.' });

  const correoOk = correo === '' ? false : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
  const telOk = numero === '' ? false : (numero.length >= 7 && numero.length <= 15);
  if (correo !== '' && !correoOk) return res.status(400).json({ ok: false, error: 'Correo inválido.' });
  if (!telOk && !(correoOk && correo !== '')) {
    return res.status(400).json({ ok: false, error: 'Deja un WhatsApp o un correo válido.' });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    // Mismo canal que decidirá enviarConVars() al confirmar el pago (WhatsApp
    // si dejó número, si no correo) — se lo pasamos a la página de gracias por
    // query string para que muestre el mensaje correcto ("te contactaremos por
    // WhatsApp/correo"), ya que Stripe es quien redirige ahí, no nuestro JS.
    const canal = telOk ? 'whatsapp' : 'correo';
    const urlExito = `${origin}/inscripcion-gracias.html?session_id={CHECKOUT_SESSION_ID}&canal=${canal}`;
    const urlCancelado = `${origin}/cursos/inscripcion.html?curso=${encodeURIComponent(b.curso || '')}&cancelado=1`;

    const r = await engine.iniciarInscripcion({
      cohorteId, nombre,
      whatsapp: telOk ? { pais, numero } : null,
      correo: correoOk ? correo : null,
      prospectoId,
      urlExito, urlCancelado,
    });

    if (!r.ok) {
      if (r.motivo === 'sin_cupo') return res.status(409).json({ ok: false, error: 'Ese grupo ya no tiene cupo disponible. Elige otra fecha.' });
      if (r.motivo === 'cohorte_no_existe') return res.status(404).json({ ok: false, error: 'Esa fecha ya no está disponible.' });
      console.error('[POST /api/inscripcion] Stripe:', r.error);
      return res.status(502).json({ ok: false, error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.' });
    }

    if (r.simulado) return res.json({ ok: true, simulado: true, redirect: `/inscripcion-gracias.html?simulado=1&canal=${canal}` });
    res.json({ ok: true, url: r.url });
  } catch (err) {
    console.error('[POST /api/inscripcion]', err.message);
    res.status(500).json({ ok: false, error: 'Error del servidor.' });
  }
});

/* --------------------- Webhook de Stripe --------------------- */
// req.body llega como Buffer sin parsear (express.raw en server.js, solo esta ruta).
router.post('/webhook/stripe', async (req, res) => {
  let event;
  try {
    event = providers.verificarEventoStripe(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[webhook/stripe] firma inválida:', err.message);
    return res.sendStatus(400);
  }
  res.sendStatus(200); // Stripe reintenta si no responde rápido; procesamos después.
  try {
    if (event.type === 'checkout.session.completed') {
      await engine.procesarWebhookStripe(event.data.object);
    }
  } catch (err) {
    console.error('[webhook/stripe]', err.message);
  }
});

/* --------------------- Webhook de WhatsApp (Meta) --------------------- */
// Deriva {pais, numero} de un wa_id (dígitos con lada, sin '+') para guardarlo igual
// que el formulario (telefono_pais + telefono nacional) — así el dedup sigue
// funcionando si esta misma persona después llena el formulario. Enfocado en México
// (mercado del negocio): un celular MX llega como '52'+'1'+10 dígitos (WhatsApp
// inserta ese '1' histórico) o, más raro, '52'+10 dígitos sin el '1'.
function parseWaId(from) {
  if (from.startsWith('52') && from.length === 13) return { pais: '+52', numero: from.slice(3) };
  if (from.startsWith('52') && from.length === 12) return { pais: '+52', numero: from.slice(2) };
  if (from.length > 10) return { pais: `+${from.slice(0, from.length - 10)}`, numero: from.slice(-10) };
  return { pais: null, numero: from };
}

// Verificación del webhook (Meta hace un GET al configurarlo).
router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Mensajes entrantes: cualquier respuesta del prospecto DETIENE la secuencia.
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Meta exige 200 rápido; procesamos después.
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        // Estatus de entrega de mensajes salientes (no viene por registrarMensaje
        // porque el envío original no sabe su resultado final hasta este callback
        // async de Meta). Solo se registra en consola/logs de Railway — sirve para
        // detectar fallas silenciosas tipo "accepted" en la API pero nunca entregado
        // (ej. WABA sin moneda configurada, plantilla rechazada después de aprobada, etc.)
        for (const s of change.value?.statuses || []) {
          if (s.status === 'failed') {
            const err = s.errors?.[0];
            console.error(`[webhook] mensaje ${s.id} FALLÓ para ${s.recipient_id}: ` +
              `(#${err?.code}) ${err?.title || err?.message} — ${err?.error_data?.details || ''}`);
          }
        }
        const mensajes = change.value?.messages || [];
        const contactos = change.value?.contacts || [];
        for (const m of mensajes) {
          const from = (m.from || '').replace(/\D/g, '');
          if (!from) continue;
          // El número nacional guardado es sufijo del wa_id (robusto ante el prefijo '1' de MX).
          const { rows } = await query(
            `SELECT * FROM prospectos
             WHERE telefono IS NOT NULL AND $1 LIKE '%' || telefono
             ORDER BY id DESC LIMIT 1`, [from]);
          let p = rows[0];

          if (!p) {
            // Nadie en la base con ese número: alguien escribió directo a WhatsApp sin
            // pasar por el formulario (antes esto se descartaba en silencio y solo
            // quedaba visible en Meta Business Suite). Se da de alta como prospecto
            // nuevo con la misma lógica del formulario, para que entre al panel y al
            // seguimiento igual que cualquier otro.
            const contacto = contactos.find(c => c.wa_id === m.from);
            const nombre = contacto?.profile?.name || `Contacto WhatsApp ${from}`;
            const { pais, numero } = parseWaId(from);
            const { action, prospecto } = await engine.altaProspecto({
              nombre, curso: 'Aún no decido',
              whatsapp: { pais, numero },
              correo: null, origen: 'whatsapp_directo',
            });
            p = prospecto;
            engine.afterIntake(prospecto, action); // sin await a propósito, igual que /api/leads
          }

          const texto = m.text?.body || `[${m.type || 'mensaje'}]`;
          await engine.registrarMensaje(p.id, { tipo: 'entrante', canal: 'whatsapp', estado: 'recibido', contenido: texto });
          await query(`UPDATE prospectos SET fecha_ultimo_entrante = now() WHERE id = $1`, [p.id]);

          if (p.estado_secuencia === 'activa') {
            await query(`UPDATE prospectos SET estado_secuencia = 'finalizada' WHERE id = $1`, [p.id]);
            console.info(`[webhook] prospecto #${p.id} respondió → secuencia detenida.`);
          }
        }
      }
    }
  } catch (err) {
    console.error('[POST /webhook]', err.message);
  }
});

module.exports = router;
