// src/routes.js — API pública (inscripción, certificados) + webhook de Stripe
const express = require('express');
const { query } = require('./db');
const engine = require('./engine');
const providers = require('./providers');

const router = express.Router();

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

  // Honeypot: si el campo trampa viene lleno, es un bot → se descarta en silencio (200).
  if (typeof b.empresa === 'string' && b.empresa.trim() !== '') {
    return res.json({ ok: true });
  }

  const nombre = (b.nombre || '').toString().trim();
  const correo = (b.correo || '').toString().trim();
  const numero = (b.whatsapp?.numero || '').toString().replace(/\D/g, '');
  const pais = (b.whatsapp?.pais || '').toString().trim() || null;
  const cohorteId = Number(b.cohorteId);

  if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'Nombre requerido.' });
  if (!Number.isInteger(cohorteId) || cohorteId <= 0) return res.status(400).json({ ok: false, error: 'Elige una fecha de inicio.' });

  // WhatsApp y correo son OBLIGATORIOS los dos para apartar lugar.
  const correoOk = correo !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
  const telOk = numero !== '' && numero.length >= 7 && numero.length <= 15;
  if (correo === '') return res.status(400).json({ ok: false, error: 'Correo requerido.' });
  if (!correoOk) return res.status(400).json({ ok: false, error: 'Correo inválido.' });
  if (numero === '') return res.status(400).json({ ok: false, error: 'WhatsApp requerido.' });
  if (!telOk) return res.status(400).json({ ok: false, error: 'Número de WhatsApp inválido.' });

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    // El sitio solo maneja correo desde el 1 oct 2026 (ver ESTADO.md) — mismo
    // canal que usará enviarConVars() al confirmar el pago. Se le sigue
    // pasando a la página de gracias por query string porque es Stripe quien
    // redirige ahí, no nuestro JS.
    const canal = 'correo';
    const urlExito = `${origin}/inscripcion-gracias.html?session_id={CHECKOUT_SESSION_ID}&canal=${canal}`;
    const urlCancelado = `${origin}/cursos/inscripcion.html?curso=${encodeURIComponent(b.curso || '')}&cancelado=1`;

    const r = await engine.iniciarInscripcion({
      cohorteId, nombre,
      whatsapp: telOk ? { pais, numero } : null,
      correo: correoOk ? correo : null,
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

/* --------------------- GET /certificados/:token (descarga pública) --------------------- */
// Sin login — es la liga que recibe el alumno por correo. El token es
// aleatorio (ver engine.subirCertificado), no el id del alumno, así que no
// se puede adivinar la liga de alguien más por tanteo.
router.get('/certificados/:token', async (req, res) => {
  const { rows } = await query(
    `SELECT nombre, certificado_pdf, certificado_nombre FROM alumnos WHERE certificado_token = $1`,
    [req.params.token]);
  const a = rows[0];
  if (!a || !a.certificado_pdf) return res.status(404).send('Certificado no encontrado.');
  // El nombre lleva el del alumno (con acentos): filename= va sin acentos
  // como respaldo y filename*= (RFC 5987) lleva el nombre real en UTF-8.
  const archivo = a.certificado_nombre || 'certificado.pdf';
  const ascii = archivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(archivo)}`);
  res.send(a.certificado_pdf);
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
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await engine.procesarWebhookStripe(event.data.object, event.type);
    } else if (event.type === 'customer_cash_balance_transaction.created' && event.data.object.type === 'funded') {
      // Llegó una transferencia SPEI a la CLABE de un alumno.
      await engine.procesarTransferencia(event.data.object.customer);
    }
  } catch (err) {
    console.error('[webhook/stripe]', err.message);
  }
});

module.exports = router;
