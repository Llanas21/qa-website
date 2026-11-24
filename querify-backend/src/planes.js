// src/planes.js — planes de pago (24 nov 2026)
//
// Cada grupo tiene un esquema (cohortes.plan_pagos) y cada alumno guarda el
// plan con el que se inscribió (alumnos.plan), para que los dos esquemas
// convivan mientras terminan los grupos de 2026:
//   - 'anterior' (grupos de 2026): curso de 10 semanas, plan único de 5 pagos
//     de $500.
//   - 'nuevo' (desde 2027): curso de 8 semanas; el alumno elige 4 pagos de
//     $625 (inscripción + uno cada 2 semanas) o un pago único de $2,290 al
//     inscribirse. Quien elige 4 pagos y liquida antes paga lo que le falta,
//     sin descuento (decisión del dueño).
// En todos los planes el pago N vence 2·(N−1) semanas después del inicio
// (ver SEMANAS_PAGO en engine.js), así que las fechas no dependen del plan.
const PLANES = {
  cinco:  { clave: 'cinco',  nombre: '5 pagos de $500',      pagos: 5, monto: 500 },
  cuatro: { clave: 'cuatro', nombre: '4 pagos de $625',      pagos: 4, monto: 625 },
  unico:  { clave: 'unico',  nombre: 'Pago único de $2,290', pagos: 1, monto: 2290 },
};
// El primero de cada lista es el que se ofrece primero (y el que se usa si no
// llega plan): en 2027, el pago único, que es el que el dueño prefiere vender.
const PLANES_POR_ESQUEMA = { anterior: ['cinco'], nuevo: ['unico', 'cuatro'] };
const SEMANAS_CURSO = { anterior: 10, nuevo: 8 };

const esquemaDe = c => (c?.plan_pagos === 'anterior' ? 'anterior' : 'nuevo');
const planesDe = c => PLANES_POR_ESQUEMA[esquemaDe(c)];
const semanasDe = c => SEMANAS_CURSO[esquemaDe(c)];
// La clave pedida si ese grupo la ofrece; si no, null.
const planValido = (c, clave) => (planesDe(c).includes(clave) ? clave : null);
const planPorDefecto = c => planesDe(c)[0];
// Datos de un plan; los alumnos de antes del cambio no tienen plan guardado = 5 pagos.
const plan = clave => PLANES[clave] || PLANES.cinco;

module.exports = { PLANES, esquemaDe, planesDe, semanasDe, planValido, planPorDefecto, plan };
