// src/certificados.js — genera el PDF del certificado de un alumno a partir
// de la plantilla HTML en assets/certificado/plantilla.html: se reemplazan
// {{NOMBRE_ALUMNO}} y {{NOMBRE_CURSO}} y un Chrome sin interfaz (Puppeteer)
// la imprime a PDF. Para cambiar el diseño se edita ese HTML directamente
// (se puede abrir en el navegador para ver cómo queda) — no hay nada que
// tocar aquí mientras se conserven los dos marcadores y el nombre de las
// imágenes.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { config } = require('./db');

const DIR = path.join(__dirname, '..', 'assets', 'certificado');
const IMAGENES = ['firma_david.png', 'firma_jose.png', 'logo.png'];
const ANCHO = 1308;
const ALTO = 924;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dataUri = (archivo, tipo) => `data:${tipo};base64,${fs.readFileSync(archivo).toString('base64')}`;

// Imágenes y fuentes van incrustadas como data URI: el HTML se carga con
// setContent (sin URL de origen), así que no podría resolver rutas relativas.
function armarHtml({ nombre, curso }) {
  let html = fs.readFileSync(path.join(DIR, 'plantilla.html'), 'utf8');
  for (const img of IMAGENES) {
    html = html.split(`src="${img}"`).join(`src="${dataUri(path.join(DIR, img), 'image/png')}"`);
  }
  for (const fuente of fs.readdirSync(path.join(DIR, 'fuentes'))) {
    html = html.split(`url("fuentes/${fuente}")`).join(`url("${dataUri(path.join(DIR, 'fuentes', fuente), 'font/ttf')}")`);
  }
  return html.split('{{NOMBRE_ALUMNO}}').join(esc(nombre))
    .split('{{NOMBRE_CURSO}}').join(esc(curso));
}

async function abrirNavegador() {
  if (config.chromePath) {
    return puppeteer.launch({ executablePath: config.chromePath, headless: true });
  }
  const chromium = require('@sparticuz/chromium');
  // @sparticuz/chromium descomprime su configuración de fuentes en /tmp/fonts
  // pero solo la declara cuando corre en AWS Lambda. En Railway hay que
  // declararla a mano: sin esto Chrome no carga NINGUNA fuente y el PDF sale
  // sin texto (confirmado en un contenedor Debian).
  process.env.FONTCONFIG_PATH ??= '/tmp/fonts';
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: chromium.headless,
  });
}

async function generarCertificado({ nombre, curso }) {
  const browser = await abrirNavegador();
  try {
    const page = await browser.newPage();
    // Medios de impresión ANTES de cargar: el ajuste de tamaño del nombre
    // (ajustarNombre, en la plantilla) mide el ancho disponible, y con el
    // estilo de pantalla (@media screen, con padding en el body) la tarjeta
    // puede quedar más angosta que en el PDF final.
    await page.emulateMediaType('print');
    await page.setViewport({ width: ANCHO, height: ALTO });
    await page.setContent(armarHtml({ nombre, curso }), { waitUntil: 'networkidle0', timeout: 30000 });
    // FontFace.load() rechaza si una fuente no se pudo cargar: mejor fallar
    // aquí que mandar un certificado con otra letra o sin texto.
    await page.evaluate(async () => {
      await Promise.all([...document.fonts].map(f => f.load()));
      ajustarNombre();
    });
    const pdf = await page.pdf({ width: `${ANCHO}px`, height: `${ALTO}px`, printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

module.exports = { generarCertificado };
