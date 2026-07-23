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

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  initLeadForm();
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
      window.location.href = form.dataset.gracias || GRACIAS_URL;
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
