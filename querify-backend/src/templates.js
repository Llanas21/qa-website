// src/templates.js — contenido de los mensajes de la secuencia + cobro de pagos
// Variables: {{1}} nombre, {{2}} curso, {{3}} fecha de inicio (solo "valor") o
// número de pago (solo "pago"), {{4}} monto y {{5}} liga de pago (solo "pago").
// Para WhatsApp se envían como PLANTILLAS de Meta por nombre + parámetros.
// Para correo / modo simulación se usa el texto renderizado de abajo.

const asunto = {
  bienvenida:  'Información del curso de {{2}} — Querify Analytics',
  recordatorio:'¿Te quedó alguna duda sobre el curso de {{2}}?',
  valor:       'Cupo limitado — curso de {{2}} en Querify Analytics',
  cierre:      'Seguimos aquí cuando estés listo — {{2}}',
  pago:        'Pago {{3}}/5 por vencer — curso de {{2}}',
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
};

// Cuántos parámetros usa cada plantilla (para armar el componente body de Meta)
const numVars = { bienvenida: 2, recordatorio: 2, valor: 3, cierre: 2, pago: 5 };

// {{N}} genérico (antes solo soportaba {{1}}..{{3}}) para poder agregar la
// plantilla de "pago" sin tocar el reemplazo de las 4 plantillas existentes.
function fill(str, vars) {
  return str.replace(/\{\{(\d+)\}\}/g, (_, i) => vars[Number(i) - 1] ?? '');
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
