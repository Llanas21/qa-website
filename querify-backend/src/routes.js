// src/routes.js — API pública (formulario) + webhook de WhatsApp
const express = require('express');
const { config, query } = require('./db');
const engine = require('./engine');

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

/* --------------------- Webhook de WhatsApp (Meta) --------------------- */
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
        const mensajes = change.value?.messages || [];
        for (const m of mensajes) {
          const from = (m.from || '').replace(/\D/g, '');
          if (!from) continue;
          // El número nacional guardado es sufijo del wa_id (robusto ante el prefijo '1' de MX).
          const { rows } = await query(
            `SELECT * FROM prospectos
             WHERE telefono IS NOT NULL AND $1 LIKE '%' || telefono
             ORDER BY id DESC LIMIT 1`, [from]);
          const p = rows[0];
          if (!p) continue;

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
