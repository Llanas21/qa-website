/* =============================================================
   Querify Analytics — comportamiento del sitio
   ============================================================= */

/* --- PENDIENTE BACKEND (Fase 5): endpoint que recibirá el lead ---
   Cuando el backend esté listo, apunta esta constante a tu API real,
   p. ej. "https://api.querifyanalytics.com/leads".
   Mientras no exista backend, el formulario valida y redirige a
   gracias.html (flujo asíncrono tal como quedó definido en el brief). */
const LEADS_ENDPOINT = "/api/leads";  // sitio servido por el backend (mismo origen). Si separas sitio y backend, pon la URL completa. Ponlo en null para modo demo sin backend.
const GRACIAS_URL = "gracias.html"; // se sobreescribe con el atributo data-gracias del formulario si existe

/* Longitud esperada de dígitos por código de país (validación simple, sin libphonenumber) */
const PHONE_LEN = {
  "+52": [10, 10],   // México
  "+1":  [10, 10],   // EE. UU. / Canadá
  "+34": [9, 9],     // España
  "+54": [10, 11],   // Argentina
  "+57": [10, 10],   // Colombia
  "+56": [9, 9],     // Chile
  "+51": [9, 9],     // Perú
  "+593":[8, 10],    // Ecuador
  "+502":[8, 8],     // Guatemala
  "+503":[8, 8]      // El Salvador
};

/* Endpoint de la inscripción con pago (apartar lugar). Mismo backend que LEADS_ENDPOINT. */
const COHORTES_ENDPOINT = "/api/cohortes"; // + "/" + curso
const INSCRIPCION_ENDPOINT = "/api/inscripcion";

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  initLeadForm();
  initInscripcionForm();
  setYear();
});

/* ---------------- Menú móvil ---------------- */
function initMobileNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("primary-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach(a =>
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );
}

/* ---------------- Año dinámico en el footer ---------------- */
function setYear() {
  document.querySelectorAll("[data-year]").forEach(el => {
    el.textContent = new Date().getFullYear();
  });
}

/* ---------------- Formulario de captura ---------------- */
function initLeadForm() {
  const form = document.getElementById("lead-form");
  if (!form) return;

  const nameField  = form.querySelector('[data-field="nombre"]');
  const phoneField = form.querySelector('[data-field="whatsapp"]');
  const mailField  = form.querySelector('[data-field="correo"]');
  const contactErr = form.querySelector('[data-error="contacto"]');

  const nameInput  = form.querySelector('#nombre');
  const ccSelect   = form.querySelector('#cc');
  const phoneInput = form.querySelector('#whatsapp');
  const mailInput  = form.querySelector('#correo');
  const honeypot   = form.querySelector('#empresa'); // campo trampa oculto

  // Solo dígitos en el teléfono
  phoneInput.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "");
    clearError(phoneField); clearError(contactErr);
  });
  nameInput.addEventListener("input", () => clearError(nameField));
  mailInput.addEventListener("input", () => { clearError(mailField); clearError(contactErr); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Honeypot: si un bot lo llenó, descartamos en silencio
    if (honeypot && honeypot.value.trim() !== "") return;

    let ok = true;
    const nombre = nameInput.value.trim();
    const correo = mailInput.value.trim();
    const tel    = phoneInput.value.trim();
    const cc     = ccSelect.value;

    // 1) Nombre obligatorio
    if (nombre.length < 2) { setError(nameField, "Escribe tu nombre."); ok = false; }

    // 2) Correo: si viene, validar formato
    let mailOk = false;
    if (correo !== "") {
      mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
      if (!mailOk) { setError(mailField, "Revisa el formato del correo."); ok = false; }
    }

    // 3) WhatsApp: si viene, validar longitud simple por país
    let phoneOk = false;
    if (tel !== "") {
      const [min, max] = PHONE_LEN[cc] || [7, 15];
      phoneOk = tel.length >= min && tel.length <= max;
      if (!phoneOk) { setError(phoneField, `El número debe tener ${min === max ? min : min + " a " + max} dígitos.`); ok = false; }
    }

    // 4) Al menos uno de los dos (WhatsApp o correo)
    if (!(phoneOk || (mailOk && correo !== ""))) {
      if (tel === "" && correo === "") {
        setError(contactErr, "Déjanos tu WhatsApp o tu correo — al menos uno.");
        ok = false;
      } else if (!ok) {
        // ya hay errores de formato marcados arriba
      }
    }

    if (!ok) {
      const firstErr = form.querySelector(".invalid");
      if (firstErr) firstErr.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // ---- Payload que consumirá el backend ----
    const payload = {
      nombre,
      curso: form.querySelector('#curso').value,
      whatsapp: tel ? { pais: cc, numero: tel } : null,
      correo: correo || null,
      origen: "sitio_web",
      pagina: location.pathname
    };

    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.dataset.label = btn.textContent;
    btn.textContent = "Enviando…";

    // Flujo asíncrono: intentamos enviar, pero redirigimos de inmediato
    // (la experiencia no espera al mensaje de bienvenida — así quedó en el brief).
    try {
      if (LEADS_ENDPOINT) {
        await fetch(LEADS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        // Sin backend todavía: dejamos rastro en consola para verificar el flujo.
        console.info("[Querify] Lead capturado (demo, sin backend):", payload);
      }
    } catch (err) {
      console.warn("[Querify] No se pudo contactar el backend, se continúa el flujo:", err);
    } finally {
      // Mismo canal que decide el backend (WhatsApp si dejó número, si no
      // correo) — se le pasa a gracias.html por query string para que
      // muestre el mensaje correcto ("te contactaremos por WhatsApp/correo").
      const canal = phoneOk ? "whatsapp" : "correo";
      const destino = form.dataset.gracias || GRACIAS_URL;
      const sep = destino.includes("?") ? "&" : "?";
      window.location.href = `${destino}${sep}canal=${canal}`;
    }
  });
}

/* ---------------- Inscripción con pago (apartar lugar) ---------------- */
function initInscripcionForm() {
  const form = document.getElementById("inscripcion-form");
  if (!form) return;

  const cursoSelect  = document.getElementById("insc-curso");
  const cohortesBox  = document.getElementById("insc-cohortes");
  // Vive fuera de <form> (su propia tarjeta lateral), por eso se busca en el documento.
  const cohorteErr   = document.querySelector('[data-error="cohorte"]');
  const generalErr   = form.querySelector('[data-error="general"]');
  const contactErr   = form.querySelector('[data-error="contacto"]');

  const nameField  = form.querySelector('[data-field="nombre"]');
  const phoneField = form.querySelector('[data-field="whatsapp"]');
  const mailField  = form.querySelector('[data-field="correo"]');
  const nameInput  = document.getElementById("i-nombre");
  const ccSelect   = document.getElementById("i-cc");
  const phoneInput = document.getElementById("i-whatsapp");
  const mailInput  = document.getElementById("i-correo");
  const honeypot   = document.getElementById("i-empresa");
  const submitBtn  = form.querySelector('[type="submit"]');

  // Preselecciona el curso si viene por la URL (?curso=Excel), p. ej. desde
  // el botón "Apartar mi lugar" de cada página de curso.
  const cursoInicial = new URLSearchParams(location.search).get("curso");
  if (cursoInicial && [...cursoSelect.options].some(o => o.value === cursoInicial)) {
    cursoSelect.value = cursoInicial;
  }

  const labelModalidad = m => m === "entre_semana" ? "Entre semana" : "Sábado";
  const fmtFecha = f => new Date(f).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

  async function cargarCohortes() {
    clearError(cohorteErr);
    cohortesBox.innerHTML = '<p class="sub" style="margin:0">Cargando fechas disponibles…</p>';
    try {
      const res = await fetch(`${COHORTES_ENDPOINT}/${encodeURIComponent(cursoSelect.value)}`);
      const data = await res.json();
      const cohortes = (data && data.cohortes) || [];
      if (!cohortes.length) {
        cohortesBox.innerHTML = '<p class="sub" style="margin:0">No hay fechas disponibles por ahora para este curso. Escríbenos por WhatsApp y te avisamos en cuanto se abra un grupo.</p>';
        return;
      }
      cohortesBox.innerHTML = cohortes.map((c, i) => `
        <label class="cohorte-opt">
          <input type="radio" name="cohorte" value="${c.id}" ${i === 0 ? "checked" : ""}>
          <span class="co-main"><b>${labelModalidad(c.modalidad)}</b><span>${fmtFecha(c.fecha_inicio)}</span></span>
          <span class="co-cupo">${c.lugares_disponibles} lugar${c.lugares_disponibles === 1 ? "" : "es"}</span>
        </label>`).join("");
    } catch (err) {
      cohortesBox.innerHTML = '<p class="sub" style="margin:0">No se pudieron cargar las fechas. Recarga la página o escríbenos por WhatsApp.</p>';
    }
  }

  cursoSelect.addEventListener("change", cargarCohortes);
  cargarCohortes();

  phoneInput.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "");
    clearError(phoneField); clearError(contactErr);
  });
  nameInput.addEventListener("input", () => clearError(nameField));
  mailInput.addEventListener("input", () => { clearError(mailField); clearError(contactErr); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (honeypot && honeypot.value.trim() !== "") return;

    let ok = true;
    const nombre = nameInput.value.trim();
    const correo = mailInput.value.trim();
    const tel    = phoneInput.value.trim();
    const cc     = ccSelect.value;

    if (nombre.length < 2) { setError(nameField, "Escribe tu nombre."); ok = false; }

    let mailOk = false;
    if (correo !== "") {
      mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
      if (!mailOk) { setError(mailField, "Revisa el formato del correo."); ok = false; }
    }

    let phoneOk = false;
    if (tel !== "") {
      const [min, max] = PHONE_LEN[cc] || [7, 15];
      phoneOk = tel.length >= min && tel.length <= max;
      if (!phoneOk) { setError(phoneField, `El número debe tener ${min === max ? min : min + " a " + max} dígitos.`); ok = false; }
    }

    if (!(phoneOk || (mailOk && correo !== "")) && tel === "" && correo === "") {
      setError(contactErr, "Déjanos tu WhatsApp o tu correo — al menos uno.");
      ok = false;
    }

    // Los radios de cohorte viven fuera de <form> (su propia tarjeta lateral),
    // igual que cohorteErr — por eso se buscan en el documento, no en el form.
    const cohorteInput = document.querySelector('input[name="cohorte"]:checked');
    if (!cohorteInput) { setError(cohorteErr, "Elige una fecha de inicio."); ok = false; }

    if (!ok) {
      const firstErr = form.querySelector(".invalid") || cohorteErr;
      if (firstErr) firstErr.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    clearError(generalErr);
    const payload = {
      nombre,
      curso: cursoSelect.value,
      cohorteId: Number(cohorteInput.value),
      whatsapp: tel ? { pais: cc, numero: tel } : null,
      correo: correo || null,
      origen: "sitio_web",
    };

    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = "Redirigiendo a pago seguro…";

    // A diferencia del formulario de contacto (fire-and-forget), aquí SÍ se
    // espera la respuesta: se necesita la URL real de Stripe (o el motivo de
    // error, p. ej. "sin cupo") antes de poder continuar.
    try {
      const res = await fetch(INSCRIPCION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        setError(generalErr, data.error || "No se pudo iniciar la inscripción. Intenta de nuevo.");
        submitBtn.disabled = false; submitBtn.textContent = label;
        return;
      }
      window.location.href = data.simulado ? data.redirect : data.url;
    } catch (err) {
      setError(generalErr, "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
      submitBtn.disabled = false; submitBtn.textContent = label;
    }
  });
}

function setError(el, msg) {
  if (!el) return;
  el.classList.add("invalid");
  const m = el.querySelector(".err-msg") || el;
  if (el.classList.contains("err-msg")) { el.textContent = msg; el.style.display = "block"; }
  else if (m.classList && m.classList.contains("err-msg")) m.textContent = msg;
}
function clearError(el) {
  if (!el) return;
  el.classList.remove("invalid");
  if (el.classList.contains("err-msg")) el.style.display = "none";
}
