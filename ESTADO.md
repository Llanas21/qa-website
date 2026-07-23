# Querify Analytics — Estado del proyecto

Última actualización: 23 de julio de 2026

## Qué es

Sistema web para Querify Analytics, academia de análisis de datos operada
en solitario (Excel, SQL Server, Power BI, Python — cursos en vivo por
Microsoft Teams, mercado México). Instagram atrae prospectos por DM; este
sistema captura sus datos de contacto por un formulario web y automatiza
el seguimiento posterior (el punto de fuga que se quería resolver: gente
que pregunta precio y desaparece).

## Estructura del repositorio

```
querify-web/          Sitio público, estático (HTML/CSS/JS, sin dependencias)
  index.html             Home
  gracias.html           Pantalla post-formulario
  cursos/*.html           4 páginas de curso (temario real de cada curso)
  assets/css/styles.css   Toda la identidad visual vive en :root
  assets/js/app.js        Validación de formulario + envío

querify-backend/       Backend Node.js (Express + PostgreSQL)
  src/                    Lógica: db, engine, providers, routes, admin, server
  db/                     schema.sql + seed.sql
  scripts/                Utilidades (hash de contraseña, init de BD)
  README.md               Cómo correr, desplegar y conectar credenciales reales
  .env.example            Todas las variables documentadas

brief-proyecto.md      Brief original (fases 1-4: planeación, arquitectura,
                        UI y funcionalidades). Es el histórico de decisiones
                        de diseño de fondo — ya no es el documento de trabajo
                        activo, este ESTADO.md lo es.
```

## Estado actual

- [x] Sitio completo y funcionando (home + 4 cursos + gracias)
- [x] Formulario con validación (nombre obligatorio, WhatsApp o correo,
      honeypot anti-spam)
- [x] Backend construido y probado (21/21 pruebas de integración):
      alta de prospectos, deduplicado de 14 días, motor de secuencia
      (recordatorio 24h → valor 72h → cierre 7 días), webhook de WhatsApp
      que detiene la secuencia si el prospecto responde
- [x] Panel de administración (`/admin`): lista con filtros, detalle con
      timeline, errores de envío, edición de fechas de inicio
- [x] Identidad visual ajustada: tema claro, azul principal claro
      (#3B82F6), sin efectos de glow, tipografías Montserrat + Work Sans
- [x] Probado en local (compu) y desde el celular en la misma red WiFi

**Pendiente para producción real:**
- [ ] Contenido: testimonios reales (hoy son de ejemplo), confirmar
      teléfonos/redes del footer, cargar las 8 fechas de inicio en el panel
- [ ] Credenciales reales: cuenta de Meta con las 4 plantillas de WhatsApp
      aprobadas, SMTP para correo de respaldo, (opcional) Microsoft Graph
      para sincronizar a Excel/SharePoint
- [ ] Desplegar en Railway (o similar) con PostgreSQL en la nube — hoy
      solo corre en la laptop
- [ ] Dominio propio (opcional)

## Decisiones ya tomadas — no reabrir sin razón concreta

- **WhatsApp:** Meta Cloud API directa (no un proveedor tercero)
- **Backend:** Node.js + Express (se evaluó Python/FastAPI, se eligió Node)
- **Base de datos:** PostgreSQL
- **Hosting recomendado:** Railway (no Render, porque el cron horario
  necesita que el servicio no se duerma)
- **Canales:** WhatsApp principal con respaldo por correo; Instagram DM
  se mantiene manual, no se automatiza
- **Regla de duplicados:** contacto repetido en <14 días → actualiza el
  curso de interés sin reiniciar la secuencia; ≥14 días → se trata como
  prospecto frío que volvió y la secuencia se reinicia desde cero
- **Identidad visual:** tema claro, azul #3B82F6 / #2563EB, sólidos y
  degradados discretos (nada de glow ni sombras grandes), tipografías
  Montserrat (títulos) + Work Sans (texto) + IBM Plex Mono (detalles
  tipo código)

## Cómo correr el proyecto en local

Instrucciones completas en `querify-backend/README.md`. En resumen:
1. Backend y base de datos: `cp .env.example .env`, llenar `DATABASE_URL`,
   `npm install`, `npm start`
2. El backend sirve el sitio automáticamente si `STATIC_DIR=../querify-web`
3. Sitio: `http://localhost:3000` — Panel: `http://localhost:3000/admin`

## Cómo retomar este proyecto en el futuro (con Claude o con quien sea)

1. Comparte este archivo (`ESTADO.md`) primero — resume todo sin tener
   que releer el historial completo del chat.
2. El código fuente de verdad vive en GitHub, no en archivos sueltos
   descargados del chat (evita el problema de estructura incompleta).
3. Para cambios de diseño/contenido pequeños: basta con describir el
   cambio. Para cambios de arquitectura (proveedor, hosting, flujo de
   datos): revisar primero la sección "Decisiones ya tomadas" de arriba,
   para no reabrir algo ya resuelto sin querer.
