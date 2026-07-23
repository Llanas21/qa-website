// src/templates.js — contenido de los 4 mensajes de la secuencia
// Variables: {{1}} nombre, {{2}} curso, {{3}} fecha de inicio (solo "valor").
// Para WhatsApp se envían como PLANTILLAS de Meta por nombre + parámetros.
// Para correo / modo simulación se usa el texto renderizado de abajo.

const asunto = {
  bienvenida:  'Información del curso de {{2}} — Querify Analytics',
  recordatorio:'¿Te quedó alguna duda sobre el curso de {{2}}?',
  valor:       'Cupo limitado — curso de {{2}} en Querify Analytics',
  cierre:      'Seguimos aquí cuando estés listo — {{2}}',
};

const cuerpo = {
  bienvenida: `¡Hola {{1}}! 👋 Gracias por tu interés en el curso de {{2}} de Querify Analytics.

Te cuento lo esencial:
📚 30 horas de capacitación 100% en vivo por Microsoft Teams
🎓 Nivel: de cero a experto
👥 Cupo limitado a 10 alumnos, para un mejor seguimiento
📜 Certificado con valor curricular al finalizar

💰 Inversión total: $2,500 MXN. Puedes apartar tu lugar con solo $625 MXN y liquidar el resto en 3 pagos a lo largo de las 10 semanas del curso.

¿Tienes dudas o quieres conocer los horarios disponibles (entre semana o sábado)? Aquí estoy para ayudarte 🙌`,

  recordatorio: `Hola {{1}}, ¿cómo estás? Quería saber si te quedó alguna duda sobre el curso de {{2}}. Con gusto te platico más sobre los horarios disponibles o cómo apartar tu lugar cuando gustes 😊`,

  valor: `Hola {{1}}, te comparto que el cupo del curso de {{2}} es limitado a solo 10 alumnos por grupo, para poder darte un seguimiento más cercano durante las clases.

La próxima generación arranca el {{3}} — si te interesa asegurar tu lugar, recuerda que puedes apartarlo con solo $625 MXN.

Cualquier duda, aquí sigo 🙌`,

  cierre: `Hola {{1}}, no quiero ser inoportuno, así que este será mi último mensaje por ahora 🙂

El curso de {{2}} sigue disponible cuando estés listo — solo escríbeme y con gusto retomamos la plática. ¡Éxito en lo que decidas! 🚀`,
};

// Cuántos parámetros usa cada plantilla (para armar el componente body de Meta)
const numVars = { bienvenida: 2, recordatorio: 2, valor: 3, cierre: 2 };

function fill(str, vars) {
  return str
    .replace(/\{\{1\}\}/g, vars[0] ?? '')
    .replace(/\{\{2\}\}/g, vars[1] ?? '')
    .replace(/\{\{3\}\}/g, vars[2] ?? '');
}

// Devuelve el texto y asunto ya renderizados (correo / simulación)
function render(tipo, vars) {
  return { asunto: fill(asunto[tipo] || '', vars), cuerpo: fill(cuerpo[tipo] || '', vars) };
}

// Devuelve los parámetros del body para la plantilla de Meta
function metaBodyParams(tipo, vars) {
  return vars.slice(0, numVars[tipo] || 0).map(v => ({ type: 'text', text: String(v ?? '') }));
}

module.exports = { render, metaBodyParams, numVars };
